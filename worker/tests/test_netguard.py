"""SSRF guard tests — no real network: IP literals, patched DNS, MockTransport."""

import socket

import httpx
import pytest

from mealy_worker import netguard
from mealy_worker.netguard import (
    UnsafeUrlError,
    assert_public_http_url,
    guarded_async_client,
)


def _fake_resolver(mapping):
    def getaddrinfo(host, *args, **kwargs):
        if host not in mapping:
            raise socket.gaierror(f"unknown host {host}")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in mapping[host]]

    return getaddrinfo


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "gopher://example.com/x",
        "http://",
        "http://127.0.0.1/admin",
        "http://[::1]:8080/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.7/internal",
        "http://192.168.1.1/router",
        "http://100.64.0.1/cgnat",
    ],
)
def test_rejects_bad_schemes_and_private_ip_literals(url):
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url(url)


def test_accepts_public_ip_literal():
    assert_public_http_url("https://1.1.1.1/image.jpg")


def test_rejects_host_resolving_to_private(monkeypatch):
    monkeypatch.setattr(
        netguard.socket, "getaddrinfo", _fake_resolver({"evil.test": ["192.168.0.10"]})
    )
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("https://evil.test/recipe")


def test_rejects_host_with_mixed_resolution(monkeypatch):
    # One public + one private address: DNS-rebinding style setup, reject.
    monkeypatch.setattr(
        netguard.socket,
        "getaddrinfo",
        _fake_resolver({"mixed.test": ["93.184.216.34", "10.0.0.5"]}),
    )
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("https://mixed.test/")


def test_accepts_public_host(monkeypatch):
    monkeypatch.setattr(
        netguard.socket, "getaddrinfo", _fake_resolver({"good.test": ["93.184.216.34"]})
    )
    assert_public_http_url("https://good.test/recipe")


def test_rejects_unresolvable_host(monkeypatch):
    monkeypatch.setattr(netguard.socket, "getaddrinfo", _fake_resolver({}))
    with pytest.raises(UnsafeUrlError):
        assert_public_http_url("https://nowhere.test/")


async def test_client_blocks_private_url_before_sending():
    async with guarded_async_client() as client:
        with pytest.raises(UnsafeUrlError):
            await client.get("http://127.0.0.1/steal")


async def test_client_blocks_redirect_to_private_target(monkeypatch):
    monkeypatch.setattr(
        netguard.socket, "getaddrinfo", _fake_resolver({"good.test": ["93.184.216.34"]})
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})

    async with guarded_async_client(
        transport=httpx.MockTransport(handler), follow_redirects=True
    ) as client:
        with pytest.raises(UnsafeUrlError):
            await client.get("https://good.test/start")


async def test_client_allows_public_fetch(monkeypatch):
    monkeypatch.setattr(
        netguard.socket, "getaddrinfo", _fake_resolver({"good.test": ["93.184.216.34"]})
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"ok")

    async with guarded_async_client(transport=httpx.MockTransport(handler)) as client:
        response = await client.get("https://good.test/recipe")
    assert response.status_code == 200
