# Cloudflare 公网部署

系统仍只运行一套 Node 服务和一套正式 SQLite。Cloudflare Tunnel 将 HTTPS 域名转发到 `http://127.0.0.1:5177`，访问者只需浏览器。

## 必填配置

在本机 `.env` 配置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=5177
PUBLIC_ORIGIN=https://你的子域名
PUBLIC_BASE_URL=https://你的子域名
CF_ACCESS_TEAM_DOMAIN=你的团队.cloudflareaccess.com
CF_ACCESS_AUD=Access应用Audience
ACCESS_VIEWER_EMAILS=
ACCESS_OPERATOR_EMAILS=
ACCESS_ADMIN_EMAILS=
```

生产模式缺少 `CF_ACCESS_TEAM_DOMAIN` 或 `CF_ACCESS_AUD` 时，服务会拒绝启动。不要把 Tunnel Token、Access JWT、CE Token 或密码写入代码和 Git。

## Cloudflare 控制台

1. 创建 Tunnel，把公网主机名指向 `http://127.0.0.1:5177`。
2. 创建 Access Self-hosted Application，域名使用同一公网主机名。
3. Access 策略只允许已确认邮箱。
4. 把 Application Audience 填入本机 `.env`。
5. Tunnel Token 仅在主电脑管理员终端执行 Cloudflare 提供的安装命令。

## 权限

- `VIEWER`：查看页面、明细和历史。
- `OPERATOR`：查看，并可导入、处理和导出。
- `ADMIN`：包含操作权限，并可管理 CE 登录、清空、备份和系统设置。

所有生产请求验证 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience 和有效期；写操作同时校验 `Origin`。审计日志不记录密码、Token、Cookie 或 Authorization。
