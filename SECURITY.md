# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

**DO NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email**: Send details to security@krakenchat.app
2. **GitHub Security Advisories**: Use [GitHub's private vulnerability reporting](https://github.com/krakenchat/kraken/security/advisories/new)

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
- Kraken backend API
- Kraken frontend application
- Electron desktop application
- Docker images and Helm charts
- Authentication and authorization flaws
- Data exposure vulnerabilities

### Out of Scope

- Self-hosted instances with modified code
- Third-party dependencies (report to upstream)
- Social engineering attacks
- Physical security

## Security Best Practices for Self-Hosting

If you're self-hosting Kraken:

1. **Change all default secrets** in your `.env` and Helm values
2. **Use HTTPS** with valid TLS certificates
3. **Keep dependencies updated** - watch for Dependabot alerts
4. **Restrict network access** to your PostgreSQL and Redis instances
5. **Enable authentication** on all database connections
6. **Regularly backup** your data
7. **Monitor logs** for suspicious activity

## Acknowledgments

We appreciate security researchers who help keep Kraken safe. Contributors who responsibly disclose vulnerabilities will be acknowledged here (with permission).
