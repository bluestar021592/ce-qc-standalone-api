# Validation gates

Before merging this stability architecture change:

1. Syntax-check the public facade, interactive owner, and regression test.
2. Run the dedicated interactive stability regression.
3. Run the repository's existing go-live preflight and Windows launcher/regression workflows through the pull request.
4. Do not use production business data in CI and do not mutate the production database.

The deployment verification target on the existing local database is startup responsiveness, home navigation, six business dashboards, history selection, and export entry availability without re-uploading daily reports or re-running CE APIs.
