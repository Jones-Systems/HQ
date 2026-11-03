"""Binding must not wait for reverse DNS before Planner reports readiness."""

import socket
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from planning.server import ThreadingHTTPServer


class StartupTests(unittest.TestCase):
    def assert_bind_without_reverse_dns(self, server_type, bound_address):
        server = SimpleNamespace(server_address=(bound_address[0], 0))

        def bind(instance):
            instance.server_address = bound_address

        with patch("socketserver.TCPServer.server_bind", autospec=True, side_effect=bind) as tcp_bind:
            with patch("socket.getfqdn", side_effect=AssertionError("startup attempted reverse DNS")) as lookup:
                server_type.server_bind(server)

        tcp_bind.assert_called_once_with(server)
        lookup.assert_not_called()
        self.assertEqual(server.server_name, bound_address[0])
        self.assertEqual(server.server_port, bound_address[1])

    def test_ipv4_bind_preserves_assigned_port_without_reverse_dns(self):
        self.assert_bind_without_reverse_dns(ThreadingHTTPServer, ("127.0.0.1", 43210))

    def test_ipv6_subclass_inherits_bind_without_reverse_dns(self):
        server_type = type("ThreadingHTTPServerV6", (ThreadingHTTPServer,), {"address_family": socket.AF_INET6})
        self.assert_bind_without_reverse_dns(server_type, ("::1", 43211, 0, 0))
