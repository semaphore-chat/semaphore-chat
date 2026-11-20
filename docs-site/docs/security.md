# Security

## Reporting vulnerabilities

Report security issues via [GitHub private vulnerability reporting](https://github.com/semaphore-chat/semaphore-chat/security/advisories/new). Include a description, steps to reproduce, and potential impact. Only maintainers can see the report until a fix is released.

## Your IP address and other sites

Messages can point at other sites. By default the app loads some pictures from those sites directly in your browser or desktop app, so those sites see your IP address:

- the picture and site icon of a link preview (the server reads the linked page, but the pictures come from the site),
- a message that is only a GIF link, drawn as the GIF,
- a webhook's avatar, when its address points at another site.

Avatars, banners, custom emoji and attachments always come from your own instance.

To stop this, open **Settings > Privacy** and turn off **Load pictures and previews from other sites**. Link previews then show only their title, site and description, a GIF link stays a link, and webhooks show their initial. The setting follows your account to every device. Two exceptions: the GIF picker still loads its GIFs from the GIF provider while you browse it, and app versions older than the setting keep loading pictures.

## Self-hosting checklist

- [ ] Change all default JWT secrets — generate with `openssl rand -base64 32`
- [ ] Use HTTPS with valid TLS certificates
- [ ] Restrict network access to PostgreSQL and Redis (don't expose ports publicly)
- [ ] Enable authentication on all database connections
- [ ] Keep images updated — watch for [Dependabot alerts](https://github.com/semaphore-chat/semaphore-chat/security/dependabot)
- [ ] Back up PostgreSQL regularly
