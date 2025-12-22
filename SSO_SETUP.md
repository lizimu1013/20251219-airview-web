# SSO 登录联调说明

## 背景

在本项目中，SSO 回调入口为 `/authorize`。如果该路径没有被后端处理，而是被前端 SPA 接管，就会触发循环重定向，表现为页面不断“闪烁”或 URL `redirect` 参数不断嵌套。

## 现象与原因

- 现象：`/authorize?redirect=...` 中 `redirect` 不断嵌套，登录无法完成。
- 原因：`/authorize` 没有命中后端，前端路由守卫把它当作未登录页面又跳回 `/login`，从而形成死循环。

## 开发环境修复（已验证可用）

在 `vite.config.ts` 的 `server.proxy` 中增加 `/authorize` 代理到后端：

```ts
proxy: {
  '/api': { target: 'http://localhost:3000', changeOrigin: true },
  '/authorize': { target: 'http://localhost:3000', changeOrigin: true },
},
```

这样 `/authorize` 会走后端，回调时可写入 `localStorage` 的 `urm_token`，自动登录即可完成。

## 线上环境建议（Nginx）

确保 `/authorize` 走后端（例如 5347），避免被静态资源或 SPA 路由吞掉：

```nginx
location = /authorize {
  proxy_pass http://127.0.0.1:5347;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 验证方式

1. 访问 `https://airview.rnd.huawei.com/authorize` 应直接 302 跳转到 SSO 登录页。
2. 回调 `/authorize?code=...` 返回 HTML 中应包含 `localStorage.setItem('urm_token', ...)`。
3. 登录后 `/api/me` 返回 200，页面不再循环跳转。

## 退出说明

前端点击“退出”会先清理本地 token，然后重定向到后端 `/api/sso/logout`，再由后端跳转到
`https://uniportal.huawei.com/saaslogin1/oauth2/logout` 以清除 IDaaS 的浏览器凭证。
退出后会回到 `/login?manual=1`，避免自动再次发起 SSO 登录。
如果设置了 `SSO_REDIRECT_URI`，退出回跳会优先使用其域名，避免拼出 `localhost`。
