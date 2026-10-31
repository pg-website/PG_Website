from django.urls import path

from . import views

# Mounted at /api/. Ids are matched loosely and validated in the services (a malformed id is a 404 envelope, not a 500).
# Paths must not collide with content's `events/<slug>` and `events/<slug>/availability` (this adds `/registration`).
urlpatterns = [
    # R01-R08
    path('events/<str:slug>/registration', views.RegistrationStateView.as_view()),
    path('registrations', views.ReserveView.as_view()),
    path('registrations/waitlist', views.WaitlistView.as_view()),
    path('registrations/<str:registration_id>', views.RegistrationDetailView.as_view()),
    path('registrations/<str:registration_id>/cancel', views.CancelView.as_view()),
    path('registrations/<str:registration_id>/accept-offer', views.AcceptOfferView.as_view()),
    path('payments/orders', views.PaymentOrderView.as_view()),
    path('payments/verify', views.PaymentVerifyView.as_view()),
    # Public player profile (no auth)
    path('players/<str:public_id>', views.PublicProfileView.as_view()),
    # M01-M04
    path('me/next-up', views.NextUpView.as_view()),
    path('me/recent-games', views.RecentGamesView.as_view()),
    path('me/people', views.PeopleView.as_view()),
    path('me/registrations', views.MyRegistrationsView.as_view()),
    # M05-M09
    path('me/events/<str:event_id>/room', views.RoomView.as_view()),
    path('me/events/<str:event_id>/check-in', views.CheckInView.as_view()),
    path('me/events/<str:event_id>/results', views.SubmitResultView.as_view()),
    path('me/events/<str:event_id>/results/<str:pairing_id>/confirm', views.ConfirmResultView.as_view()),
    path('me/events/<str:event_id>/results/<str:pairing_id>/dispute', views.DisputeResultView.as_view()),
]
