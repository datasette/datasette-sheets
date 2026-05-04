from datasette import Forbidden
from datasette_plugin_router import Router
from functools import wraps

router = Router()

PERMISSION_NAME = "datasette-sheets-access"


def check_permission():
    def decorator(func):
        @wraps(func)
        async def wrapper(datasette, request, **kwargs):
            if not await datasette.allowed(action=PERMISSION_NAME, actor=request.actor):
                raise Forbidden("Permission denied")
            return await func(datasette=datasette, request=request, **kwargs)

        return wrapper

    return decorator
