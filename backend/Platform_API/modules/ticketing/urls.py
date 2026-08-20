from django.urls import path

from . import views


urlpatterns = [
    path("dashboard/", views.TicketingDashboardView.as_view(), name="ticketing-dashboard"),
    path("config/", views.TicketingConfigAPIView.as_view(), name="ticketing-config"),
    path("keys/", views.TicketingApiKeyListCreateView.as_view(), name="ticketing-keys"),
    path("keys/<int:pk>/", views.TicketingApiKeyDetailView.as_view(), name="ticketing-key-detail"),
    path("forms/", views.TicketFormSchemaListCreateView.as_view(), name="ticketing-forms"),
    path("forms/<int:pk>/", views.TicketFormSchemaDetailView.as_view(), name="ticketing-form-detail"),
    path("routing-rules/", views.TicketRoutingRuleListCreateView.as_view(), name="ticketing-routing-rules"),
    path("routing-rules/<int:pk>/", views.TicketRoutingRuleDetailView.as_view(), name="ticketing-routing-rule-detail"),
    path("webhooks/", views.TicketWebhookEndpointListCreateView.as_view(), name="ticketing-webhooks"),
    path("webhooks/<int:pk>/", views.TicketWebhookEndpointDetailView.as_view(), name="ticketing-webhook-detail"),
    path("tickets/", views.AgentTicketListCreateView.as_view(), name="ticketing-tickets"),
    path("tickets/<int:pk>/", views.AgentTicketDetailView.as_view(), name="ticketing-ticket-detail"),
    path("tickets/<int:pk>/reply/", views.AgentTicketReplyAPIView.as_view(), name="ticketing-ticket-reply"),
    path("v1/tickets/", views.PublicTicketCreateListExportAPIView.as_view(), name="public-ticket-create-list"),
    path("v1/tickets/track/", views.PublicTicketTrackAPIView.as_view(), name="public-ticket-track"),
    path("v1/tickets/export/", views.PublicTicketExportAPIView.as_view(), name="public-ticket-export"),
    path("v1/tickets/<str:public_id>/status/", views.PublicTicketStatusAPIView.as_view(), name="public-ticket-status"),
    path("v1/tickets/<str:public_id>/timeline/", views.PublicTicketTimelineAPIView.as_view(), name="public-ticket-timeline"),
    path("v1/tickets/<str:public_id>/reply/", views.PublicTicketReplyAPIView.as_view(), name="public-ticket-reply"),
    path("v1/tickets/<str:public_id>/close/", views.PublicTicketCloseAPIView.as_view(), name="public-ticket-close"),
]

