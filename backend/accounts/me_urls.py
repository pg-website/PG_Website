from django.urls import path

from . import views

# Mounted at /api/me/. Other /me/* endpoints (registrations, room, ratings) belong to later slices.
urlpatterns = [
    path('profile', views.ProfileView.as_view()),
    path('public-identity', views.PublicIdentityView.as_view()),
    path('preferences', views.PreferencesView.as_view()),
    path('password', views.ChangePasswordView.as_view()),
]
