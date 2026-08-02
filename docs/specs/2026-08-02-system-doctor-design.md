# System Doctor: audit et auto-heal planifie de Claude Code

Date: 2026-08-02
Statut: valide (brainstorming + revision cross-platform)

## Probleme

L'installation Claude Code d'une machine derive avec le temps: caches de plugins
qui se re-clonent, fichiers temporaires, projets orphelins, drift de
configuration, contexte de demarrage qui gonfle. Un audit manuel (realise le
2026-08-02) a libere ~5 Go et divise le contexte de demarrage par deux, mais il
ne se reproduit pas tout seul. Objectif: un plugin distribuable qui refait cet
audit a intervalle regulier, soigne ce qui est sans risque, et rapporte le reste.

## Decisions actees

| Decision | Choix |
|---|---|
| Autonomie | Safe-ops auto + rapport. Jamais de heal automatique hors liste blanche |
| Scheduler | Natif OS: launchd (macOS), crontab (Linux), schtasks (Windows) |
| Cadence | Choisie a l'installation (defaut: hebdomadaire) |
| Distribution | Plugin Claude Code installable, meme resultat sur les 3 OS |
| Rapport | Fichier local complet + resume optionnel via webhook (Discord/Slack) |
| Runtime | Node pur zero dependance (garanti par Claude Code), jamais bash/powershell |

## Architecture

```
claude-system-doctor/
├── .claude-plugin/
│   ├── plugin.json            # name: system-doctor
│   └── marketplace.json
├── skills/
│   ├── audit/SKILL.md         # le run: collecte, classe, heal, rapporte
│   ├── setup/SKILL.md         # installation interactive du scheduler
│   └── remove/SKILL.md        # desinstallation propre
├── scripts/
│   ├── collect.js             # collecte deterministe, sortie JSON
│   └── schedule.js            # cree/supprime l'entree scheduler par OS
├── docs/specs/
└── README.md
```

### Flux d'un run

1. Le scheduler OS lance `claude -p "/system-doctor:audit"` en headless.
2. Le skill audit execute `node ${CLAUDE_PLUGIN_ROOT}/scripts/collect.js`:
   mesures pures, AUCUNE destruction, sortie JSON unique.
3. Claude classe chaque trouvaille: AUTO (liste blanche) ou REPORT.
4. AUTO: archive tar.gz dans `~/Archives/doctor/` PUIS suppression.
5. Rapport complet dans `~/.claude/doctor/reports/YYYY-MM-DD.md`,
   resume ~10 lignes pousse au webhook si configure (fetch natif Node).
6. `~/.claude/doctor/state.json` mis a jour (baselines, date du run).

### Etat et configuration

- `~/.claude/doctor/config.json`: cadence, heure, webhook, seuils, dry_run.
  Ecrit par `/system-doctor:setup`.
- `~/.claude/doctor/state.json`: baselines (tailles par categorie, empreinte de
  configuration, tokens de demarrage), date/statut du dernier run.
- Premier run = calibration: capture les baselines, ne heal rien.

## Checks

| # | Check | Classe |
|---|---|---|
| 1 | Tailles par categorie de `~/.claude` + delta vs baseline | REPORT si derive > seuil (defaut 20%) |
| 2 | Caches/marketplaces sans plugin installe correspondant (`installed_plugins.json`) | AUTO (archive puis rm) |
| 3 | Fichiers temporaires: `temp_git_*`, `temp_subdir_*`, `*.tmp`, `*.bak`, `~/.claude.json.backup*` | AUTO |
| 4 | Prune par age (> retention, defaut 30j): `file-history/`, `paste-cache/`, `shell-snapshots/` | AUTO |
| 5 | Projets orphelins candidats dans `projects/` (chemin decode absent) | REPORT toujours |
| 6 | Drift de configuration vs empreinte baseline: hooks dupliques settings/plugin, `enableAllProjectMcpServers`, entrees `.projects` mortes dans `~/.claude.json`, changements `skillOverrides` | REPORT |
| 7 | Contexte de demarrage reel du run (usage API du run lui-meme) vs baseline | REPORT si derive > seuil |
| 8 | `MEMORY.md` proche des limites (200 lignes / 25 Ko), memory files > 10 Ko | REPORT |
| 9 | Serveurs MCP configures en echec de connexion | REPORT |

Le check 5 est REPORT-only par design: le slug de `projects/` derive du repo
git et non du chemin; un dossier au chemin disparu peut porter la memoire
active d'un repo demenage (cas reel du 2026-08-02). Aucune heuristique ne
fiabilise ce cas, donc jamais de suppression automatique.

Le check 6 fonctionne par empreinte (drift vs baseline capturee au premier
run), pas par regles codees en dur: portable sur toute machine sans rien
connaitre de la configuration de l'utilisateur.

## Garde-fous

- Blocklist absolue, gravee dans le SKILL.md audit: `memory/`, `skills/`,
  `settings.json`, `CLAUDE.md`, `~/.claude.json`, credentials, `projects/`,
  `commands/`, `agents/`. Aucune action AUTO ne touche ces chemins, quel que
  soit le verdict des checks.
- Toute suppression AUTO est precedee d'une archive tar.gz horodatee dans
  `~/Archives/doctor/` (Windows: `%USERPROFILE%\Archives\doctor`).
  Retention 90j; le doctor purge ses propres archives expirees (seule
  exception a la regle d'archive).
- `dry_run` (config ou `/system-doctor:audit dry`): tout passe en REPORT.
- Headless-safe: aucun MCP requis, webhook via fetch natif; un echec webhook
  n'echoue pas le run (log + note au rapport suivant).
- Echec de run: le scheduler logue dans `~/.claude/doctor/runs.log`; le run
  suivant detecte le trou de calendrier et le signale.

## Setup et remove

`/system-doctor:setup` (interactif):
1. Demande cadence (quotidien/hebdo/mensuel) + heure, canal de rapport
   (webhook URL / fichier seul / notification OS), seuils.
2. Ecrit `config.json`.
3. `node scripts/schedule.js install`: selon `process.platform`,
   - darwin: `~/Library/LaunchAgents/com.claude.system-doctor.plist` + `launchctl load`
   - linux: entree `crontab` utilisateur (marqueur `# claude-system-doctor`)
   - win32: `schtasks /create /tn ClaudeSystemDoctor`
4. Propose un run de calibration immediat.

`/system-doctor:remove`: supprime l'entree scheduler (launchctl unload + rm /
crontab -l filtre / schtasks /delete), conserve config, state, rapports et
archives.

## Tests

- `collect.js`: execute sur fixture (arborescence `~/.claude` factice via
  variable d'env `DOCTOR_HOME` pour rediriger la racine) et compare la sortie
  JSON attendue. Meme fixture sur les 3 OS en CI GitHub Actions
  (matrix macos/ubuntu/windows).
- `schedule.js`: mode `--print` qui affiche la commande/plist/entree generee
  sans l'installer; asserts par plateforme.
- Scenario de non-regression grave en fixture: dossier projects/ au chemin
  disparu MAIS memory/ present et recent = doit sortir en REPORT, jamais AUTO.
- Mise en service reelle: run manuel `/system-doctor:audit dry` valide par
  l'utilisateur avant `setup`.

## Hors scope (YAGNI)

Interface TUI (claude-code-cleaner existe), heal des projets orphelins,
condensation automatique des memoires, multi-machine/sync, telemetrie.
