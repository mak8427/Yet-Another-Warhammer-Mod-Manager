import type { AppState } from '../../store'
import { store } from '../../store'
import { ConflictScreen } from '../conflicts/ConflictScreen'
import { ModsScreen } from '../mod-list/ModsScreen'
import { ProfilesScreen } from '../profiles/ProfilesScreen'
import { SettingsScreen } from '../settings/SettingsScreen'
import { WorkshopScreen } from '../workshop/WorkshopScreen'
import { ErrorBanner } from './ErrorBanner'
import { SectionRail } from './SectionRail'

interface WorkspaceProps {
  state: AppState
}

export function Workspace({ state }: WorkspaceProps) {
  if (!state.snapshot || !state.profiles) return null

  return (
    <div className="workspace">
      <SectionRail
        view={state.view}
        modCount={state.snapshot.mods.length}
        enabledCount={state.snapshot.enabledCount}
        profileCount={state.profiles.profiles.length}
        conflictCount={state.conflicts?.conflicts.length ?? 0}
        workshopCount={state.workshop?.length ?? 0}
        onSelect={(view) => store.setView(view)}
      />

      <main className="main-pane" data-region="main">
        {state.error && (
          <ErrorBanner error={state.error} onDismiss={() => store.dismissError()} />
        )}

        {state.view === 'mods' && <ModsScreen state={state} />}

        {state.view === 'profiles' && (
          <ProfilesScreen
            profiles={state.profiles}
            busy={Boolean(state.busy)}
            onApply={(id) => void store.applyProfile(id)}
            onCreate={(name) => store.saveProfile(name)}
            onRename={(id, name) => store.renameProfile(id, name)}
            onDuplicate={(id, name) => store.duplicateProfile(id, name)}
            onDelete={(id) => store.deleteProfile(id)}
          />
        )}

        {state.view === 'conflicts' && (
          <ConflictScreen
            report={state.conflicts}
            loading={state.conflictLoading}
            error={state.conflictError}
            onRefresh={() => void store.refreshConflicts()}
            onDismissError={() => store.dismissConflictError()}
          />
        )}

        {state.view === 'workshop' && (
          <WorkshopScreen
            items={state.workshop}
            loading={state.workshopLoading}
            busy={Boolean(state.busy)}
            error={state.workshopError}
            onRefresh={() => void store.refreshWorkshop()}
            onDismissError={() => store.dismissWorkshopError()}
            onAction={(action, workshopId) => void store.runWorkshopAction(action, workshopId)}
          />
        )}

        {state.view === 'settings' && <SettingsScreen state={state} />}
      </main>
    </div>
  )
}
