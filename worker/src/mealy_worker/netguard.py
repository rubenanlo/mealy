"""SSRF guard for user-supplied URLs (security follow-up from the
2026-08-21 review, closed before launch).

``/ingest/url`` and ``/image/fetch`` fetch whatever URL the caller sends.
On a hosted worker that request comes from the worker's own network, so a
malicious or mistyped URL could otherwise reach localhost, the cloud
metadata service, or anything else on the internal network. The guard
allows only http(s) URLs whose host resolves exclusively to public
("global") addresses, and re-checks every request in a redirect chain.
"""

from __future__ import annotations

import ipaddress
import socket

import httpx


class UnsafeUrlError(ValueError):
    """URL points somewhere a user-supplied fetch must not go."""


def _host_addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as err:
        raise UnsafeUrlError(f"cannot resolve host {host!r}") from err
    return [ipaddress.ip_address(info[4][0]) for info in infos]


def assert_public_http_url(url: str | httpx.URL) -> None:
    """Raise UnsafeUrlError unless url is http(s) to a public address."""
    parsed = httpx.URL(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"scheme {parsed.scheme!r} not allowed")
    host = parsed.host
    if not host:
        raise UnsafeUrlError("URL has no host")
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        addresses = _host_addresses(host)
    for address in addresses:
        # is_global is False for loopback, RFC1918, link-local (cloud
        # metadata 169.254.169.254), CGNAT, ULA, multicast and reserved.
        if not address.is_global:
            raise UnsafeUrlError(f"host {host!r} resolves to non-public {address}")


async def _guard_request(request: httpx.Request) -> None:
    assert_public_http_url(request.url)


def guarded_async_client(**kwargs) -> httpx.AsyncClient:
    """httpx.AsyncClient that validates every request URL, redirects included."""
    hooks = kwargs.setdefault("event_hooks", {})
    hooks.setdefault("request", []).append(_guard_request)
    return httpx.AsyncClient(**kwargs)
