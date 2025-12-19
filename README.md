# 用户需求管理（多用户版）

基于 `分析说明书.md` 的 Vue 3 + Element Plus + Node.js 后端 + SQLite 数据库：支持多用户登录、角色权限（requester/reviewer/admin）、需求提交、列表筛选搜索、详情页评论、接纳/挂起/拒绝/待补充等状态流转与审计日志。

## 运行

> 若你的 npm 缓存目录有权限问题，可用 `--cache .npm-cache`。

```bash
npm install --cache .npm-cache
npm run dev
```

## 默认账号

- 首次启动会自动创建管理员：`admin / admin123`（可用环境变量 `ADMIN_PASSWORD` 覆盖）
- 上线务必设置 `JWT_SECRET` 并修改管理员密码（或通过“用户管理”重置）

## 上线（单进程一体化）

```bash
npm install --omit=dev --cache .npm-cache
npm run build
JWT_SECRET=... ADMIN_PASSWORD=... npm run start
```

后端默认端口 `3000`，会同时提供：

- API：`/api/*`
- 前端静态资源：`dist/`（由后端托管）

## Docker（可选）

```bash
docker compose up --build
```
