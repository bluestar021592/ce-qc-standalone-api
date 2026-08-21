# V252 System Settings Recovery

V252 separates system settings and CE connector login from dashboard bootstrap.

Acceptance focus:
- authenticated `/settings` HTML receives `v252-settings-recovery.js`;
- `/api/v252/settings-shell` returns current internal user, CE auth status and network information without loading dashboard/business tables;
- `/api/v252/ce-login` is reachable only from an authenticated LOCAL/LAN session and requires the external CE account credentials;
- CE login remains bounded by the CE client timeout and reports success/failure visibly;
- dashboard bootstrap may continue in the background but cannot leave settings at `正在读取...` or block CE connector login;
- the existing WHPP authenticated fast-summary authority remains unchanged.
