//! Host command construction for installed Flatpaks. Arguments never pass through a shell.
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

pub(crate) fn is_flatpak() -> bool {
    cfg!(target_os = "linux") && Path::new("/.flatpak-info").is_file()
}

pub(crate) fn command(
    executable: &Path,
    args: &[String],
    env: &BTreeMap<String, String>,
    directory: Option<&Path>,
) -> Command {
    configured_command(executable, args, env, directory, is_flatpak())
}

fn configured_command(
    executable: &Path,
    args: &[String],
    env: &BTreeMap<String, String>,
    directory: Option<&Path>,
    flatpak: bool,
) -> Command {
    if flatpak {
        let mut process = Command::new("flatpak-spawn");
        process.args(["--host", "--watch-bus"]);
        // Keep the host environment (especially PATH/LD_LIBRARY_PATH), adding
        // only the launch variables resolved by the manager.
        for (key, value) in env {
            process.arg(format!("--env={key}={value}"));
        }
        if let Some(directory) = directory {
            let mut arg = std::ffi::OsString::from("--directory=");
            arg.push(directory);
            process.arg(arg);
        }
        process.arg("--").arg(executable).args(args);
        process
    } else {
        let mut process = Command::new(executable);
        process.args(args).envs(env);
        if let Some(directory) = directory {
            process.current_dir(directory);
        }
        process
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn flatpak_preserves_arguments_environment_and_host_directory() {
        let process = configured_command(
            Path::new("/home/user/Steam Library/runtime"),
            &["--".into(), "a file;$(touch nope)".into()],
            &BTreeMap::from([("SteamAppId".into(), "1142710".into())]),
            Some(Path::new("/media/Game Disk/WH3")),
            true,
        );
        assert_eq!(process.get_program(), "flatpak-spawn");
        let args: Vec<_> = process.get_args().collect();
        assert_eq!(
            args,
            vec![
                "--host",
                "--watch-bus",
                "--env=SteamAppId=1142710",
                "--directory=/media/Game Disk/WH3",
                "--",
                "/home/user/Steam Library/runtime",
                "--",
                "a file;$(touch nope)",
            ]
            .into_iter()
            .map(OsStr::new)
            .collect::<Vec<_>>()
        );
        assert_eq!(process.get_current_dir(), None);
        assert_eq!(process.get_envs().count(), 0);
    }

    #[test]
    fn native_commands_keep_the_existing_spawn_contract() {
        let process = configured_command(
            Path::new("steam"),
            &["steam://url/CommunityFilePage/123".into()],
            &BTreeMap::from([("SteamAppId".into(), "1142710".into())]),
            Some(Path::new("/games")),
            false,
        );
        assert_eq!(process.get_program(), "steam");
        assert_eq!(process.get_current_dir(), Some(Path::new("/games")));
        assert_eq!(
            process.get_envs().next(),
            Some((OsStr::new("SteamAppId"), Some(OsStr::new("1142710"))))
        );
    }
}
