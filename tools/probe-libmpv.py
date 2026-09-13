"""Read DLL runtime identity without opening media or loading personal configuration."""
import ctypes
import json
import sys

dll = ctypes.CDLL(sys.argv[1])
dll.mpv_client_api_version.restype = ctypes.c_ulong
dll.mpv_create.restype = ctypes.c_void_p
dll.mpv_set_option_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
dll.mpv_initialize.argtypes = [ctypes.c_void_p]
dll.mpv_get_property_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
dll.mpv_get_property_string.restype = ctypes.c_void_p
dll.mpv_free.argtypes = [ctypes.c_void_p]
dll.mpv_terminate_destroy.argtypes = [ctypes.c_void_p]
handle = dll.mpv_create()
if not handle:
    raise RuntimeError('mpv_create failed')
try:
    for key, value in [(b'config', b'no'), (b'vo', b'null'), (b'ao', b'null')]:
        if dll.mpv_set_option_string(handle, key, value) < 0:
            raise RuntimeError('mpv option setup failed')
    if dll.mpv_initialize(handle) < 0:
        raise RuntimeError('mpv_initialize failed')
    api = dll.mpv_client_api_version()
    result = {'clientApi': f'{api >> 16}.{api & 65535}'}
    for name in ['mpv-version', 'libmpv-version', 'mpv-build-date', 'ffmpeg-version']:
        value = dll.mpv_get_property_string(handle, name.encode())
        result[name] = ctypes.string_at(value).decode('utf8', errors='replace') if value else None
        if value:
            dll.mpv_free(value)
    print(json.dumps(result, indent=2))
finally:
    dll.mpv_terminate_destroy(handle)
