from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import resolve

from SL_ERP.urls import frontend_login_redirect


@override_settings(ERP_FRONTEND_URL="http://localhost:5173")
class FrontendLoginRedirectTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_tenant_login_link_redirects_from_api_to_ui(self):
        match = resolve("/login/truesurf-kenya-limited")
        response = frontend_login_redirect(
            self.factory.get("/login/truesurf-kenya-limited"),
            tenant_code=match.kwargs["tenant_code"],
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "http://localhost:5173/login/truesurf-kenya-limited")

    def test_unscoped_login_link_redirects_from_api_to_ui(self):
        resolve("/login")
        response = frontend_login_redirect(self.factory.get("/login"))

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "http://localhost:5173/login")
