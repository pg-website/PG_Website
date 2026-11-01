"""Admin media (contract 3.7: S07-S11; the collection endpoints S12 were removed by PLAN-010). Default deny: every view is an AdminView."""
from __future__ import annotations

from core.responses import ok

from . import media_service as svc
from .views import AdminView
from .views_events import AdminPagePagination


class UploadsView(AdminView):  # S07
    def post(self, request):
        return ok(svc.issue_upload(request, svc.object_body(request)), status=201)


class CompleteView(AdminView):  # S08
    def post(self, request, asset_id):
        asset, created = svc.complete_upload(request, asset_id)
        data = svc.asset_dtos([asset])[0]
        data['warnings'] = [] if (asset.decorative or asset.alt) else [
            {'code': 'ALT_MISSING', 'field': 'alt', 'message': 'Add alt text or mark the image decorative.'}]
        return ok(data, status=201 if created else 200)


class AssetsView(AdminView):  # S09
    def get(self, request):
        qs = svc.list_assets(request.query_params)
        paginator = AdminPagePagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(svc.asset_dtos(page))


class AssetDetailView(AdminView):  # S10, S11 (and a read of one asset)
    def get(self, request, asset_id):
        asset = svc.get_asset(asset_id)
        return ok(svc.asset_dtos([asset])[0])

    def patch(self, request, asset_id):
        version, changes = svc.parse_asset_patch(svc.object_body(request))
        asset, warnings = svc.update_asset(request, asset_id, version, changes)
        data = svc.asset_dtos([asset])[0]
        data['warnings'] = warnings
        return ok(data)

    def delete(self, request, asset_id):
        svc.delete_asset(request, asset_id)
        return ok()
