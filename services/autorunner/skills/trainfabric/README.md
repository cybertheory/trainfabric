# Canonical skill lives at:
#   apps/dashboard/content/skills/trainfabric/SKILL.md
#
# Keep this copy identical (Box / soft-refresh / agent_mutate load it from here too).
# Regenerate:
#   cp apps/dashboard/content/skills/trainfabric/SKILL.md \
#      services/autorunner/skills/trainfabric/SKILL.md
#   cp apps/dashboard/content/skills/trainfabric/SKILL.md \
#      services/compute/app/hermes/skills/trainfabric/SKILL.md
#
# GPU handoff: agents write TrainFabric `/r2/` query-result URLs to
# artifacts/data_url.txt; starter train.py allowlists and downloads them.
