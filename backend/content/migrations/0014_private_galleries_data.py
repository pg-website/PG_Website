"""PLAN-010 TASK-1004: every media collection becomes a private gallery owned by exactly one event, story or site
section slot. A collection used by several owners keeps its first owner and is cloned for each other one (the clone
gets a fresh key and the same ordered items). Historical models skip signals and `save()` side effects, so no
revalidation rows are written: public output is unchanged."""
import secrets

from django.db import migrations


def _clone(MediaCollection, MediaCollectionItem, source, owner_kind, owner_ref):
    while True:
        key = f"{owner_kind.replace('_', '-')}-{secrets.token_hex(6)}"
        if not MediaCollection.objects.filter(key=key).exists():
            break
    clone = MediaCollection.objects.create(
        key=key, name="", mode=source.mode, autoplay=source.autoplay, interval_ms=source.interval_ms,
        owner_kind=owner_kind, owner_ref=owner_ref)
    MediaCollectionItem.objects.bulk_create([
        MediaCollectionItem(collection=clone, asset_id=i.asset_id, order=i.order)
        for i in MediaCollectionItem.objects.filter(collection=source).order_by("order", "id")])
    return clone


def _claim(MediaCollection, MediaCollectionItem, collection_id, owner_kind, owner_ref):
    """-> collection id the owner should use (the original when free or already theirs, else a clone)."""
    c = MediaCollection.objects.get(pk=collection_id)
    if c.owner_kind == "":
        c.owner_kind, c.owner_ref = owner_kind, owner_ref
        c.save(update_fields=["owner_kind", "owner_ref"])
        return c.pk
    if c.owner_kind == owner_kind and c.owner_ref == owner_ref:
        return c.pk
    return _clone(MediaCollection, MediaCollectionItem, c, owner_kind, owner_ref).pk


def _walk(value, path, found):
    if isinstance(value, dict):
        if set(value) == {"collection"} and isinstance(value["collection"], str):
            found.append((path or "content", value["collection"]))
            return
        for k, x in value.items():
            _walk(x, f"{path}.{k}" if path else k, found)
    elif isinstance(value, list):
        for i, x in enumerate(value):
            _walk(x, f"{path}.{i}" if path else str(i), found)


def _rewrite(value, path, mapping):
    if isinstance(value, dict):
        if set(value) == {"collection"} and isinstance(value["collection"], str):
            return {"collection": mapping.get((path or "content", value["collection"]), value["collection"])}
        return {k: _rewrite(x, f"{path}.{k}" if path else k, mapping) for k, x in value.items()}
    if isinstance(value, list):
        return [_rewrite(x, f"{path}.{i}" if path else str(i), mapping) for i, x in enumerate(value)]
    return value


def forwards(apps, schema_editor):
    Event = apps.get_model("content", "Event")
    Story = apps.get_model("content", "Story")
    SiteSection = apps.get_model("content", "SiteSection")
    ContentDraft = apps.get_model("content", "ContentDraft")
    MediaCollection = apps.get_model("content", "MediaCollection")
    MediaCollectionItem = apps.get_model("content", "MediaCollectionItem")

    for e in Event.objects.exclude(media_id=None, archive_gallery_id=None):
        changed = []
        if e.media_id:
            new = _claim(MediaCollection, MediaCollectionItem, e.media_id, "event", str(e.pk))
            if new != e.media_id:
                e.media_id = new
                changed.append("media")
        if e.archive_gallery_id:
            new = _claim(MediaCollection, MediaCollectionItem, e.archive_gallery_id, "event_archive", str(e.pk))
            if new != e.archive_gallery_id:
                e.archive_gallery_id = new
                changed.append("archive_gallery")
        if changed:
            Event.objects.filter(pk=e.pk).update(**{f"{c}_id": getattr(e, f"{c}_id") for c in changed})

    for s in Story.objects.exclude(collection_id=None):
        new = _claim(MediaCollection, MediaCollectionItem, s.collection_id, "story", str(s.pk))
        if new != s.collection_id:
            Story.objects.filter(pk=s.pk).update(collection_id=new)

    # Site sections: the live copy claims first, then the draft. The same slot in live and draft may share a gallery
    # (the admin forks a draft copy on the first edit of a published slot).
    rows = [(r, r.key) for r in SiteSection.objects.all()]
    drafts = {d.key: d for d in ContentDraft.objects.filter(kind="site")}
    for row, key in rows:
        for holder in (row, drafts.get(key)):
            if holder is None:
                continue
            found = []
            _walk(holder.content, "", found)
            mapping = {}
            for path, ckey in found:
                coll = MediaCollection.objects.filter(key=ckey).first()
                if coll is None:
                    continue
                new_id = _claim(MediaCollection, MediaCollectionItem, coll.pk, "site_section", f"{key}:{path}")
                if new_id != coll.pk:
                    mapping[(path, ckey)] = MediaCollection.objects.get(pk=new_id).key
            if mapping:
                holder.content = _rewrite(holder.content, "", mapping)
                holder.save(update_fields=["content"])
    for key, d in drafts.items():
        if key in {k for _r, k in rows}:
            continue
        found = []
        _walk(d.content, "", found)
        mapping = {}
        for path, ckey in found:
            coll = MediaCollection.objects.filter(key=ckey).first()
            if coll is None:
                continue
            new_id = _claim(MediaCollection, MediaCollectionItem, coll.pk, "site_section", f"{key}:{path}")
            if new_id != coll.pk:
                mapping[(path, ckey)] = MediaCollection.objects.get(pk=new_id).key
        if mapping:
            d.content = _rewrite(d.content, "", mapping)
            d.save(update_fields=["content"])

    # Normalise the derived mode: one image is static, two or more is a carousel.
    for c in MediaCollection.objects.exclude(owner_kind=""):
        n = MediaCollectionItem.objects.filter(collection=c).count()
        mode = "carousel" if n >= 2 else "static"
        if c.mode != mode:
            MediaCollection.objects.filter(pk=c.pk).update(mode=mode)


class Migration(migrations.Migration):

    dependencies = [
        ("content", "0013_private_galleries"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
