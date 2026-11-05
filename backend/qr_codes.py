"""Authenticated printable QR generation. QR payloads contain only a public camera URL."""
from urllib.parse import urlencode, urlsplit
import xml.etree.ElementTree as ET

from fastapi import APIRouter, HTTPException, Request, Response
import qrcode
from qrcode.image.svg import SvgPathFillImage


def camera_url(base_url: str, room_id: str, camera_id: str) -> str:
    try:
        url = urlsplit(base_url)
        valid_port = url.port
    except ValueError:
        raise HTTPException(400, 'Invalid server address')
    if (url.scheme not in ('http', 'https') or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment or url.path not in ('', '/')):
        raise HTTPException(400, 'Use only the server origin, without keys, credentials or query parameters')
    return f'{url.scheme}://{url.netloc}/camera/room/?{urlencode({"room":room_id,"camera":camera_id})}'


def qr_router() -> APIRouter:
    router = APIRouter()

    @router.get('/api/single/rooms/{room_id}/qr/{camera_id}.svg')
    async def qr(room_id: str, camera_id: str, request: Request, base_url: str | None = None):
        rooms = request.app.state.rooms
        if room_id not in rooms.members or camera_id not in rooms.camera_ids(room_id):
            raise HTTPException(404, 'Unknown room or camera')
        target = camera_url(base_url or str(request.base_url), room_id, camera_id)
        image = qrcode.make(target, image_factory=SvgPathFillImage, border=4)
        root = ET.fromstring(image.to_string())
        description = ET.Element('{http://www.w3.org/2000/svg}desc')
        description.text = target
        root.insert(0, description)
        return Response(ET.tostring(root, encoding='utf-8'), media_type='image/svg+xml',
                        headers={'Cache-Control':'private, max-age=3600'})

    return router
