//! Portable profile share files (`wh3mm-profile` v1).
//!
//! A share file identifies mods by pack file name and optional Steam Workshop
//! id instead of the session's path-derived mod ids. It therefore survives a
//! different Steam library, drive, or operating system, and it never contains
//! absolute paths, local mod ids, tags, or preferences.
//!
//! Importing creates a profile only when every entry resolves; otherwise the
//! caller receives the unresolved entries so the UI can tell the user what to
//! install before trying again.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::atomic::atomic_write;
use crate::clock::now_iso8601;
use crate::config::validate_profile_name;
use crate::error::AppError;
use crate::ipc::{MissingShareMod, Profile};
use crate::mod_index::DiscoveredMod;
use crate::workshop::community_page_url;

pub const SHARE_FORMAT: &str = "wh3mm-profile";
pub const SHARE_FORMAT_VERSION: u32 = 1;
pub const MAX_SHARE_BYTES: u64 = 1024 * 1024;
pub const MAX_SHARE_MODS: usize = 10_000;

const MAX_PACK_NAME_LEN: usize = 260;
const MAX_DISPLAY_NAME_LEN: usize = 120;
const MAX_WORKSHOP_ID_LEN: usize = 20;
const MAX_URL_LEN: usize = 300;
const STEAM_COMMUNITY_HOST: &str = "steamcommunity.com";

/// The whole share file. Unknown fields are ignored so a newer build can add
/// optional metadata without breaking older ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareDocument {
    pub format: String,
    pub format_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<ShareApp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<String>,
    pub profile: ShareProfile,
}

/// Informational producer metadata; never used for validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareApp {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareProfile {
    pub name: String,
    /// Array order is the load order.
    #[serde(default)]
    pub mods: Vec<ShareMod>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareMod {
    /// Pack file name; the portable match key.
    pub pack: String,
    /// Steam Workshop id; preferred match key when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workshop_id: Option<String>,
    /// Display name from the exporter; never used for matching.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Canonical Workshop page URL, for display only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// A built document plus the count of enabled mods that could not be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltShare {
    pub document: ShareDocument,
    pub skipped: u32,
}

/// Resolved ids in file order, plus the entries that are not installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedShare {
    pub ids: Vec<String>,
    pub missing: Vec<MissingShareMod>,
}

/// Encodes one profile as a share document. Enabled mods that the running scan
/// cannot resolve are counted in `skipped` and left out of the file.
pub fn build(profile: &Profile, mods: &[DiscoveredMod], app_version: &str) -> BuiltShare {
    let by_id: HashMap<&str, &DiscoveredMod> = mods
        .iter()
        .map(|module| (module.id.as_str(), module))
        .collect();
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut skipped = 0u32;
    for id in &profile.enabled_mod_ids {
        let Some(module) = by_id.get(id.as_str()) else {
            skipped += 1;
            continue;
        };
        // Never write a name that the parser would refuse to read back.
        if validate_pack_name(&module.name).is_err() {
            skipped += 1;
            continue;
        }
        if !seen.insert(module.name.to_lowercase()) {
            continue;
        }
        entries.push(ShareMod {
            pack: module.name.clone(),
            workshop_id: module.workshop_id.clone(),
            name: display_name(&module.human_name),
            url: module.workshop_id.as_deref().map(community_page_url),
        });
    }

    BuiltShare {
        document: ShareDocument {
            format: SHARE_FORMAT.to_string(),
            format_version: SHARE_FORMAT_VERSION,
            app: Some(ShareApp {
                name: "WH3 Mod Manager".to_string(),
                version: app_version.to_string(),
            }),
            exported_at: Some(now_iso8601()),
            profile: ShareProfile {
                name: profile.name.clone(),
                mods: entries,
            },
        },
        skipped,
    }
}

/// Serializes a document as pretty JSON with a trailing newline.
pub fn encode(document: &ShareDocument) -> Result<Vec<u8>, AppError> {
    let mut bytes = serde_json::to_vec_pretty(document).map_err(|error| {
        AppError::internal("Could not serialize the profile file").with_details(error.to_string())
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Parses and normalizes a share document. Unknown fields are ignored; a newer
/// `formatVersion` is refused instead of being partially read.
pub fn decode(bytes: &[u8]) -> Result<ShareDocument, AppError> {
    if bytes.len() as u64 > MAX_SHARE_BYTES {
        return Err(AppError::validation("This profile file is too large"));
    }
    let document: ShareDocument = serde_json::from_slice(bytes).map_err(|error| {
        AppError::validation("That file is not a WH3 Mod Manager profile")
            .with_details(error.to_string())
    })?;
    normalize(document)
}

/// Reads a share file from disk, refusing anything larger than the limit.
pub fn read_from(path: &Path) -> Result<ShareDocument, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|error| AppError::io_path("Could not read the profile file", path, &error))?;
    if metadata.len() > MAX_SHARE_BYTES {
        return Err(AppError::validation("This profile file is too large"));
    }
    let bytes = fs::read(path)
        .map_err(|error| AppError::io_path("Could not read the profile file", path, &error))?;
    decode(&bytes)
}

/// Writes a share file atomically so a failed write never leaves a partial file.
pub fn write_to(path: &Path, document: &ShareDocument) -> Result<(), AppError> {
    let bytes = encode(document)?;
    atomic_write(path, &bytes)
        .map_err(|error| AppError::io_path("Could not save the profile file", path, &error))
}

/// Maps a document onto the mods installed here. Workshop ids win over pack
/// names so a renamed local copy still matches the exported item.
pub fn resolve(document: &ShareDocument, mods: &[DiscoveredMod]) -> ResolvedShare {
    let by_workshop: HashMap<&str, &DiscoveredMod> = mods
        .iter()
        .filter_map(|module| module.workshop_id.as_deref().map(|id| (id, module)))
        .collect();
    let by_name: HashMap<String, &DiscoveredMod> = mods
        .iter()
        .map(|module| (module.name.to_lowercase(), module))
        .collect();

    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    let mut missing = Vec::new();
    for entry in &document.profile.mods {
        let found = entry
            .workshop_id
            .as_deref()
            .and_then(|id| by_workshop.get(id).copied())
            .or_else(|| by_name.get(&entry.pack.to_lowercase()).copied());
        match found {
            Some(module) => {
                if seen.insert(module.id.as_str()) {
                    ids.push(module.id.clone());
                }
            }
            None => missing.push(MissingShareMod {
                pack: entry.pack.clone(),
                name: entry.name.clone(),
                workshop_id: entry.workshop_id.clone(),
                url: entry.url.clone(),
            }),
        }
    }
    ResolvedShare { ids, missing }
}

fn normalize(document: ShareDocument) -> Result<ShareDocument, AppError> {
    if document.format != SHARE_FORMAT {
        return Err(
            AppError::validation("That file is not a WH3 Mod Manager profile")
                .with_details(format!("unexpected format {:?}", document.format)),
        );
    }
    if document.format_version > SHARE_FORMAT_VERSION {
        return Err(AppError::validation(
            "This profile was exported by a newer version of the mod manager; update the app to import it",
        ));
    }
    if document.format_version != SHARE_FORMAT_VERSION {
        return Err(AppError::validation(
            "This profile file has an unsupported format version",
        ));
    }
    let name = validate_profile_name(&document.profile.name)?;
    if document.profile.mods.len() > MAX_SHARE_MODS {
        return Err(AppError::validation(
            "This profile file lists too many mods",
        ));
    }

    let mut mods = Vec::with_capacity(document.profile.mods.len());
    let mut seen = HashSet::new();
    for entry in document.profile.mods {
        let pack = validate_pack_name(&entry.pack)?;
        if !seen.insert(pack.to_lowercase()) {
            continue;
        }
        let mut workshop_id = entry.workshop_id.and_then(|id| validate_workshop_id(&id));
        let url = entry.url.and_then(|url| canonical_workshop_url(&url));
        if workshop_id.is_none() {
            workshop_id = url.as_deref().and_then(workshop_id_from_url);
        }
        // Keep the link and the id consistent: a hand-edited file can carry a
        // URL for a different item, and the id is what the dialog opens.
        let url = workshop_id.as_deref().map(community_page_url).or(url);
        mods.push(ShareMod {
            pack,
            workshop_id,
            name: display_name(entry.name.as_deref().unwrap_or_default()),
            url,
        });
    }

    Ok(ShareDocument {
        format: document.format,
        format_version: document.format_version,
        app: document.app,
        exported_at: document.exported_at,
        profile: ShareProfile { name, mods },
    })
}

/// A pack name must be a bare `.pack` file name, never a path.
fn validate_pack_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation(
            "The profile file has a mod entry without a pack name",
        ));
    }
    if name.len() > MAX_PACK_NAME_LEN {
        return Err(AppError::validation(
            "A pack name in the profile file is too long",
        ));
    }
    if !name.to_ascii_lowercase().ends_with(".pack") {
        return Err(AppError::validation(format!(
            "{name:?} is not a pack file name"
        )));
    }
    if name.contains("..")
        || name
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':') || character.is_control())
    {
        return Err(AppError::validation(format!(
            "{name:?} is not a valid pack file name"
        )));
    }
    Ok(name.to_string())
}

fn validate_workshop_id(id: &str) -> Option<String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > MAX_WORKSHOP_ID_LEN
        || !id.chars().all(|character| character.is_ascii_digit())
    {
        return None;
    }
    Some(id.to_string())
}

/// Returns the canonical URL for a recognized Workshop page, or `None` for
/// anything else. Only `https` on the Steam Community host is accepted; the URL
/// is display data and is never opened by the application.
fn canonical_workshop_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.len() > MAX_URL_LEN {
        return None;
    }
    let rest = url.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    if !host.eq_ignore_ascii_case(STEAM_COMMUNITY_HOST) {
        return None;
    }
    let (path, query) = path.split_once('?')?;
    if path != "sharedfiles/filedetails/" && path != "workshop/filedetails/" {
        return None;
    }
    let id = query.strip_prefix("id=")?;
    validate_workshop_id(id).map(|id| community_page_url(&id))
}

fn workshop_id_from_url(url: &str) -> Option<String> {
    url.split_once("id=")
        .and_then(|(_, id)| validate_workshop_id(id))
}

fn display_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chars(trimmed, MAX_DISPLAY_NAME_LEN).to_string())
}

fn truncate_chars(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = 0;
    for (index, character) in text.char_indices() {
        let next = index + character.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::path::PathBuf;

    fn module(name: &str, workshop_id: Option<&str>) -> DiscoveredMod {
        DiscoveredMod {
            id: format!("/game/data/{name}"),
            path: PathBuf::from(format!("/game/data/{name}")),
            name: name.to_string(),
            human_name: name.trim_end_matches(".pack").to_string(),
            is_workshop: workshop_id.is_some(),
            workshop_id: workshop_id.map(str::to_string),
            thumbnail_path: None,
            updated_at: None,
            dependencies: Vec::new(),
            pack_error: None,
            is_movie: false,
            size_bytes: 1,
        }
    }

    fn profile(name: &str, ids: Vec<&str>) -> Profile {
        Profile {
            id: "profile-1".to_string(),
            name: name.to_string(),
            enabled_mod_ids: ids.into_iter().map(str::to_string).collect(),
            created_at: "2026-10-20T12:00:00Z".to_string(),
            updated_at: "2026-10-20T12:00:00Z".to_string(),
        }
    }

    fn document(profile_name: &str, mods: Vec<ShareMod>) -> ShareDocument {
        ShareDocument {
            format: SHARE_FORMAT.to_string(),
            format_version: SHARE_FORMAT_VERSION,
            app: None,
            exported_at: None,
            profile: ShareProfile {
                name: profile_name.to_string(),
                mods,
            },
        }
    }

    fn entry(pack: &str, workshop_id: Option<&str>) -> ShareMod {
        ShareMod {
            pack: pack.to_string(),
            workshop_id: workshop_id.map(str::to_string),
            name: None,
            url: None,
        }
    }

    #[test]
    fn build_writes_portable_entries_with_workshop_links() {
        let mods = vec![
            module("local.pack", None),
            module("workshop.pack", Some("2921395471")),
        ];
        let profile = profile("Campaign", vec![mods[1].id.as_str(), mods[0].id.as_str()]);

        let built = build(&profile, &mods, "1.0.0");

        assert_eq!(built.skipped, 0);
        assert_eq!(built.document.profile.name, "Campaign");
        let packs: Vec<&str> = built
            .document
            .profile
            .mods
            .iter()
            .map(|entry| entry.pack.as_str())
            .collect();
        assert_eq!(packs, vec!["workshop.pack", "local.pack"]);
        assert_eq!(
            built.document.profile.mods[0].url.as_deref(),
            Some("https://steamcommunity.com/sharedfiles/filedetails/?id=2921395471")
        );
        assert!(built.document.profile.mods[1].url.is_none());
    }

    #[test]
    fn build_counts_enabled_mods_it_cannot_resolve() {
        let mods = vec![module("known.pack", None)];
        let profile = profile(
            "Campaign",
            vec![mods[0].id.as_str(), "/game/data/missing.pack"],
        );

        let built = build(&profile, &mods, "1.0.0");

        assert_eq!(built.skipped, 1);
        assert_eq!(built.document.profile.mods.len(), 1);
    }

    #[test]
    fn encode_decode_round_trip_keeps_order_and_links() {
        let doc = document(
            "Campaign",
            vec![
                ShareMod {
                    pack: "b.pack".to_string(),
                    workshop_id: Some("42".to_string()),
                    name: Some("Bee".to_string()),
                    url: Some(community_page_url("42")),
                },
                entry("a.pack", None),
            ],
        );

        let bytes = encode(&doc).unwrap();
        assert!(bytes.ends_with(b"\n"));

        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.profile.name, "Campaign");
        assert_eq!(decoded.profile.mods[0].pack, "b.pack");
        assert_eq!(decoded.profile.mods[1].pack, "a.pack");
        assert_eq!(decoded.profile.mods[0].workshop_id.as_deref(), Some("42"));
        assert_eq!(
            decoded.profile.mods[0].url.as_deref(),
            Some(community_page_url("42").as_str())
        );
    }

    #[test]
    fn write_and_read_round_trip_through_a_file() {
        let dir = TempDir::new("profile-share-round-trip");
        let path = dir.path().join("campaign.wh3mm-profile.json");
        let doc = document("Campaign", vec![entry("a.pack", None)]);

        write_to(&path, &doc).unwrap();
        let read = read_from(&path).unwrap();

        assert_eq!(read, doc);
    }

    #[test]
    fn refuses_a_newer_format_version() {
        let mut doc = document("Campaign", Vec::new());
        doc.format_version = 2;

        let error = decode(&encode(&doc).unwrap()).unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::Validation);
        assert!(error.message.contains("newer version"));
    }

    #[test]
    fn refuses_an_unknown_format() {
        let mut doc = document("Campaign", Vec::new());
        doc.format = "something-else".to_string();

        let error = decode(&encode(&doc).unwrap()).unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::Validation);
        assert!(error.message.contains("not a WH3 Mod Manager profile"));
    }

    #[test]
    fn ignores_unknown_fields_for_forward_compatibility() {
        let text = format!(
            r#"{{"format":"{SHARE_FORMAT}","formatVersion":1,"futureField":true,"profile":{{"name":"Campaign","mods":[{{"pack":"a.pack","extra":1}}]}}}}"#
        );

        let decoded = decode(text.as_bytes()).unwrap();

        assert_eq!(decoded.profile.mods.len(), 1);
    }

    #[test]
    fn rejects_pack_names_that_look_like_paths() {
        for pack in [
            "",
            "   ",
            "../a.pack",
            "data/a.pack",
            "data\\a.pack",
            "Z:/a.pack",
            "a.txt",
        ] {
            let error = decode(&encode(&document("Campaign", vec![entry(pack, None)])).unwrap())
                .unwrap_err();
            assert_eq!(
                error.code,
                crate::error::ErrorCode::Validation,
                "pack {pack:?} should be refused"
            );
        }
    }

    #[test]
    fn dedupes_repeated_pack_names_case_insensitively() {
        let doc = document(
            "Campaign",
            vec![entry("mod.pack", Some("1")), entry("MOD.PACK", Some("2"))],
        );

        let decoded = decode(&encode(&doc).unwrap()).unwrap();

        assert_eq!(decoded.profile.mods.len(), 1);
        assert_eq!(decoded.profile.mods[0].workshop_id.as_deref(), Some("1"));
    }

    #[test]
    fn drops_urls_that_do_not_point_at_a_workshop_item() {
        for url in [
            "http://steamcommunity.com/sharedfiles/filedetails/?id=1",
            "javascript:alert(1)",
            "https://example.com/sharedfiles/filedetails/?id=1",
            "https://steamcommunity.com/profiles/1",
            "https://steamcommunity.com/sharedfiles/filedetails/?id=abc",
            "https://steamcommunity.com/sharedfiles/filedetails/?id=1&x=2",
        ] {
            let mut item = entry("mod.pack", None);
            item.url = Some(url.to_string());

            let decoded = decode(&encode(&document("Campaign", vec![item])).unwrap()).unwrap();

            assert_eq!(decoded.profile.mods.len(), 1, "entry kept for {url}");
            assert!(decoded.profile.mods[0].url.is_none(), "url dropped: {url}");
        }
    }

    #[test]
    fn recovers_a_workshop_id_from_a_canonical_url() {
        let mut item = entry("mod.pack", None);
        item.url =
            Some("https://SteamCommunity.com/workshop/filedetails/?id=2921395471".to_string());

        let decoded = decode(&encode(&document("Campaign", vec![item])).unwrap()).unwrap();

        assert_eq!(
            decoded.profile.mods[0].workshop_id.as_deref(),
            Some("2921395471")
        );
        assert_eq!(
            decoded.profile.mods[0].url.as_deref(),
            Some(community_page_url("2921395471").as_str())
        );
    }

    #[test]
    fn derive_display_name_and_url_from_a_workshop_id_only() {
        let mut item = entry("mod.pack", Some("77"));
        item.url = None;

        let decoded = decode(&encode(&document("Campaign", vec![item])).unwrap()).unwrap();

        assert_eq!(
            decoded.profile.mods[0].url.as_deref(),
            Some(community_page_url("77").as_str())
        );
    }

    #[test]
    fn the_workshop_id_wins_over_a_conflicting_url() {
        let mut item = entry("mod.pack", Some("111"));
        item.url = Some(community_page_url("222"));

        let decoded = decode(&encode(&document("Campaign", vec![item])).unwrap()).unwrap();

        assert_eq!(decoded.profile.mods[0].workshop_id.as_deref(), Some("111"));
        assert_eq!(
            decoded.profile.mods[0].url.as_deref(),
            Some(community_page_url("111").as_str())
        );
    }

    #[test]
    fn resolve_prefers_the_workshop_id_then_the_pack_name() {
        let mods = vec![
            module("renamed_here.pack", Some("111")),
            module("byname.pack", None),
        ];
        let doc = document(
            "Campaign",
            vec![
                entry("original_name.pack", Some("111")),
                entry("BYNAME.PACK", None),
            ],
        );

        let resolved = resolve(&doc, &mods);

        assert_eq!(resolved.ids, vec![mods[0].id.clone(), mods[1].id.clone()]);
        assert!(resolved.missing.is_empty());
    }

    #[test]
    fn resolve_reports_missing_entries_in_file_order() {
        let mods = vec![module("present.pack", None)];
        let mut absent = entry("absent.pack", Some("9"));
        absent.name = Some("Absent".to_string());
        let doc = decode(
            &encode(&document(
                "Campaign",
                vec![entry("present.pack", None), absent],
            ))
            .unwrap(),
        )
        .unwrap();

        let resolved = resolve(&doc, &mods);

        assert_eq!(resolved.ids, vec![mods[0].id.clone()]);
        assert_eq!(resolved.missing.len(), 1);
        assert_eq!(resolved.missing[0].pack, "absent.pack");
        assert_eq!(resolved.missing[0].name.as_deref(), Some("Absent"));
        assert_eq!(resolved.missing[0].workshop_id.as_deref(), Some("9"));
        assert_eq!(
            resolved.missing[0].url.as_deref(),
            Some(community_page_url("9").as_str())
        );
    }

    #[test]
    fn refuses_an_oversized_file() {
        let bytes = vec![b' '; MAX_SHARE_BYTES as usize + 1];

        let error = decode(&bytes).unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::Validation);
        assert!(error.message.contains("too large"));
    }

    #[test]
    fn accepts_a_profile_without_mods() {
        let decoded = decode(&encode(&document("Vanilla", Vec::new())).unwrap()).unwrap();

        assert!(decoded.profile.mods.is_empty());
    }
}
