"""Players, payments ledger and settings (contract 3.8: G01-G08). Default deny: every view is an AdminView."""
from __future__ import annotations

from core.idempotency import run_idempotent
from core.responses import ok

from . import ledger_service as ls
from . import players_service as ps
from . import settings_service as ss
from .views import AdminView
from .views_events import AdminPagePagination


class PlayersView(AdminView):
    def get(self, request):
        paginator, items = ps.list_players(request, AdminPagePagination)
        return paginator.get_paginated_response(items)

    def post(self, request):
        from .permissions import require_step_up
        require_step_up(request)
        return run_idempotent(request, lambda: ok(ps.create_player(request, request.data), status=201), required=True)


class PlayerDetailView(AdminView):
    def get(self, request, player_id):
        return ok(ps.get_player(request, player_id), headers={'Cache-Control': 'no-store'})


class PlayerRoleView(AdminView):
    def put(self, request, player_id):
        # Idempotency-Key is required (contract G03); step-up is consumed inside the work.
        return run_idempotent(request, lambda: ok(ps.change_role(request, player_id, request.data)), required=True)


class LedgerView(AdminView):
    def get(self, request):
        paginator, items = ls.list_ledger(request, AdminPagePagination)
        return paginator.get_paginated_response(items)


class RefundView(AdminView):
    def post(self, request, payment_id):
        return run_idempotent(request, lambda: ok(ls.refund(request, payment_id, request.data)), required=True)


class ReconcileView(AdminView):
    def post(self, request):
        return ok(ls.reconcile(request, request.data))


class SettingsView(AdminView):
    def get(self, request):
        return ok(ss.read())

    def patch(self, request):
        return ok(ss.update(request, request.data))
