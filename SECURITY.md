# Security Policy

## Supported Versions

The latest 0.x minor release is supported and receives security fixes. Older
minor releases are not supported: please upgrade to the latest release.

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

**DO NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email**: Send details to security@semaphorechat.app
2. **GitHub Security Advisories**: Use [GitHub's private vulnerability reporting](https://github.com/semaphore-chat/semaphore-chat/security/advisories/new)

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution Timeline**: Depends on severity, typically 30-90 days

### Scope

The following are in scope:
- Semaphore Chat backend API
- Semaphore Chat frontend application
- Electron desktop application
- Native desktop client (`native/`)
- Docker images and Helm charts
- Authentication and authorization flaws
- Data exposure vulnerabilities

### Out of Scope

- Self-hosted instances with modified code
- Third-party dependencies (report to upstream)
- Social engineering attacks
- Physical security

## Security Best Practices for Self-Hosting

If you're self-hosting Semaphore Chat:

1. **Change all default secrets** in your `.env` and Helm values
2. **Use HTTPS** with valid TLS certificates
3. **Keep dependencies updated** - watch for Dependabot alerts
4. **Restrict network access** to your PostgreSQL and Redis instances
5. **Enable authentication** on all database connections
6. **Regularly backup** your data
7. **Monitor logs** for suspicious activity

## Acknowledgments

We appreciate security researchers who help keep Semaphore Chat safe. Contributors who responsibly disclose vulnerabilities will be acknowledged here (with permission).
