"""client_ip: the rate-limit key. Cloud Run appends the real caller to X-Forwarded-For, so the
right-most entries are trusted and anything the caller wrote in front of them is not."""
from types import SimpleNamespace

from app.deps import client_ip


def req(fwd, peer="10.9.9.9"):
    headers = {} if fwd is None else {"x-forwarded-for": fwd}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))


def test_rightmost_entry_is_the_client():
    assert client_ip(req("6.6.6.6, 1.2.3.4"), 1) == "1.2.3.4"


def test_spoofed_first_entries_do_not_change_the_key():
    assert client_ip(req("a, 1.2.3.4"), 1) == client_ip(req("b, c, 1.2.3.4"), 1) == "1.2.3.4"


def test_two_hops():
    assert client_ip(req("6.6.6.6, 1.2.3.4, 10.0.0.1"), 2) == "1.2.3.4"


def test_no_header_uses_the_socket_peer():
    assert client_ip(req(None, peer="9.9.9.9"), 1) == "9.9.9.9"


def test_fewer_entries_than_hops_uses_the_socket_peer():
    assert client_ip(req("1.2.3.4", peer="9.9.9.9"), 2) == "9.9.9.9"
