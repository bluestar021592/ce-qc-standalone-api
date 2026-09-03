# CE QC CI quota-safe policy

- `go-live-preflight.yml` is the single automatic push/PR gate.
- `final-system-regression.yml` remains available as an isolated manual diagnostic gate.
- `v329-windows-gate.yml` remains available as the Windows-specific manual release gate.
- Automatic gates use `concurrency.cancel-in-progress` so superseded commits do not keep consuming GitHub-hosted runner minutes.
- The production updater still runs `npm run test:golive` locally before installation; this policy does not weaken the local install gate or touch production data.
