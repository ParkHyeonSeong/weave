import httpx
import respx

from weave_mcp.client import WeaveClient
from weave_mcp.config import Settings


def make_client(token="wv_test_token"):
    return WeaveClient(settings=Settings(base_url="http://test", token=token))


@respx.mock
async def test_call_sends_bearer_header():
    route = respx.get("http://test/api/branches").mock(return_value=httpx.Response(200, json=[]))
    c = make_client("wv_abc")
    await c.call("GET", "/api/branches")
    await c.aclose()
    assert route.calls[0].request.headers.get("authorization") == "Bearer wv_abc"


@respx.mock
async def test_call_json_success_returns_parsed_body():
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(200, json=[{"id": 1}]))
    c = make_client()
    result = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert result == [{"id": 1}]


def test_client_uses_granular_timeout():
    c = make_client()
    t = c._http.timeout
    assert t.connect == 5.0
    assert t.read == 30.0
    assert t.write == 10.0
    assert t.pool == 5.0


@respx.mock
async def test_call_json_status_true_returns_body_unchanged():
    respx.get("http://test/api/auth/me").mock(
        return_value=httpx.Response(200, json={"status": True, "profile": {"user_id": 1}})
    )
    c = make_client()
    result = await c.call_json("GET", "/api/auth/me")
    await c.aclose()
    assert result == {"status": True, "profile": {"user_id": 1}}


@respx.mock
async def test_http_404_with_unified_body_is_not_found():
    respx.get("http://test/api/branches/9/tasks/5").mock(
        return_value=httpx.Response(404, json={
            "status": False, "message": "TASK_NOT_FOUND", "code": "TASK_NOT_FOUND",
            "category": "not_found", "retryable": False}))
    c = make_client()
    out = await c.call_json("GET", "/api/branches/9/tasks/5")
    await c.aclose()
    assert out["error"]["category"] == "not_found"
    assert out["error"]["code"] == "TASK_NOT_FOUND"
    assert out["error"]["http_status"] == 404


@respx.mock
async def test_http_401_need_login_is_auth():
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(
        401, json={"status": False, "message": "NEED_LOGIN", "code": "NEED_LOGIN",
                   "category": "auth", "retryable": False}))
    c = make_client()
    out = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert out["error"]["category"] == "auth"


@respx.mock
async def test_http_401_admin_required_is_forbidden_not_auth():
    # the load-bearing fix: same 401, body category wins
    respx.get("http://test/api/admin/x").mock(return_value=httpx.Response(
        401, json={"status": False, "message": "ADMIN_REQUIRED", "code": "ADMIN_REQUIRED",
                   "category": "forbidden", "retryable": False}))
    c = make_client()
    out = await c.call_json("GET", "/api/admin/x")
    await c.aclose()
    assert out["error"]["category"] == "forbidden"
    assert out["error"]["http_status"] == 401


@respx.mock
async def test_http_422_validation_detail_list_passthrough():
    respx.post("http://test/api/x").mock(return_value=httpx.Response(
        422, json={"detail": [{"loc": ["body", "name"], "msg": "field required"}]}))
    c = make_client()
    out = await c.call_json("POST", "/api/x")
    await c.aclose()
    assert out["error"]["category"] == "validation"
    assert out["error"]["code"] is None
    assert out["error"]["detail"] == [{"loc": ["body", "name"], "msg": "field required"}]


@respx.mock
async def test_http_429_rate_limited_no_retry_after_header():
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(
        429, json={"status": False, "message": "RATE_LIMIT_EXCEEDED", "code": "RATE_LIMIT_EXCEEDED",
                   "category": "rate_limited", "retryable": True}))
    c = make_client()
    out = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert out["error"]["category"] == "rate_limited"
    assert out["error"]["retryable"] is True
    assert out["error"]["retry_after"] is None


@respx.mock
async def test_http_429_parses_retry_after_seconds():
    respx.get("http://test/api/branches").mock(return_value=httpx.Response(
        429, headers={"Retry-After": "30"},
        json={"status": False, "code": "RATE_LIMIT_EXCEEDED", "message": "RATE_LIMIT_EXCEEDED",
              "category": "rate_limited", "retryable": True}))
    c = make_client()
    out = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert out["error"]["retry_after"] == 30


@respx.mock
async def test_uploads_empty_body_404_falls_back_to_not_found():
    respx.get("http://test/api/uploads/x.png").mock(return_value=httpx.Response(404))
    c = make_client()
    out = await c.call_json("GET", "/api/uploads/x.png")
    await c.aclose()
    assert out["error"]["category"] == "not_found"
    assert out["error"]["code"] is None


@respx.mock
async def test_http_404_free_text_message_uses_status_category():
    # categoryless, code-less, free-text 404 body → status drives category (not business)
    respx.get("http://test/api/x").mock(return_value=httpx.Response(
        404, json={"message": "Not found"}))
    c = make_client()
    out = await c.call_json("GET", "/api/x")
    await c.aclose()
    assert out["error"]["category"] == "not_found"
    assert out["error"]["code"] is None


@respx.mock
async def test_business_200_status_false_uses_body_category():
    respx.post("http://test/api/branches/9/dependencies").mock(return_value=httpx.Response(
        200, json={"status": False, "message": "CIRCULAR_DEPENDENCY", "code": "DEPENDENCY_CYCLE",
                   "category": "conflict", "retryable": False}))
    c = make_client()
    out = await c.call_json("POST", "/api/branches/9/dependencies")
    await c.aclose()
    assert out["error"]["category"] == "conflict"
    assert out["error"]["code"] == "DEPENDENCY_CYCLE"
    assert out["error"]["http_status"] == 200


@respx.mock
async def test_200_status_false_missing_message_no_whole_dict():
    respx.post("http://test/api/x").mock(return_value=httpx.Response(
        200, json={"status": False, "weird": 1}))
    c = make_client()
    out = await c.call_json("POST", "/api/x")
    await c.aclose()
    assert out["error"]["message"] is None
    assert out["error"]["category"] == "business"
    assert out["error"]["weird"] == 1


async def test_missing_token_is_auth_token_not_set():
    c = make_client(token="")
    out = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert out["error"]["category"] == "auth"
    assert out["error"]["code"] == "TOKEN_NOT_SET"


@respx.mock
async def test_network_error_is_retryable_network():
    respx.get("http://test/api/branches").mock(side_effect=httpx.ConnectError("boom"))
    c = make_client()
    out = await c.call_json("GET", "/api/branches")
    await c.aclose()
    assert out["error"]["category"] == "network"
    assert out["error"]["retryable"] is True
    assert out["error"]["http_status"] is None


@respx.mock
async def test_2xx_non_json_stays_success_text():
    respx.get("http://test/api/x").mock(return_value=httpx.Response(200, text="hello"))
    c = make_client()
    out = await c.call_json("GET", "/api/x")
    await c.aclose()
    assert out == {"text": "hello"}


@respx.mock
async def test_2xx_scalar_body_returned_verbatim():
    respx.get("http://test/api/x").mock(return_value=httpx.Response(200, json=42))
    c = make_client()
    out = await c.call_json("GET", "/api/x")
    await c.aclose()
    assert out == 42


@respx.mock
async def test_2xx_embedded_error_is_normalized():
    # 2xx body with a top-level "error" dict that is NOT yet canonical (no "retryable" key).
    # normalize_embedded delegates to error_from_body, which must produce a canonical envelope.
    respx.post("http://test/api/branches/1/members").mock(return_value=httpx.Response(
        200, json={"error": {"category": "forbidden", "code": "ADMIN_ONLY"}}
    ))
    c = make_client()
    out = await c.call_json("POST", "/api/branches/1/members")
    await c.aclose()
    assert isinstance(out["error"], dict)
    assert out["error"]["category"] == "forbidden"
    assert isinstance(out["error"]["retryable"], bool)


@respx.mock
async def test_2xx_empty_error_dict_is_normalized_failure():
    respx.post("http://test/api/x").mock(return_value=httpx.Response(200, json={"error": {}}))
    c = make_client(); out = await c.call_json("POST", "/api/x"); await c.aclose()
    assert isinstance(out["error"], dict) and out["error"]["category"] == "business"
    assert isinstance(out["error"]["retryable"], bool)


@respx.mock
async def test_2xx_empty_error_string_is_normalized_failure():
    respx.post("http://test/api/x").mock(return_value=httpx.Response(200, json={"error": ""}))
    c = make_client(); out = await c.call_json("POST", "/api/x"); await c.aclose()
    assert out["error"]["category"] == "business"


@respx.mock
async def test_2xx_null_error_is_success():
    respx.get("http://test/api/x").mock(return_value=httpx.Response(200, json={"status": True, "error": None}))
    c = make_client(); out = await c.call_json("GET", "/api/x"); await c.aclose()
    assert out == {"status": True, "error": None}   # null error = no error → raw success


@respx.mock
async def test_retry_after_non_numeric_dropped_to_none():
    respx.get("http://test/api/x").mock(return_value=httpx.Response(
        429, headers={"Retry-After": "Wed, 21 Oct 2025 07:28:00 GMT"},
        json={"status": False, "code": "RATE_LIMIT_EXCEEDED", "message": "RATE_LIMIT_EXCEEDED",
              "category": "rate_limited", "retryable": True}))
    c = make_client(); out = await c.call_json("GET", "/api/x"); await c.aclose()
    assert out["error"]["retry_after"] is None


@respx.mock
async def test_call_bytes_returns_the_response_on_success():
    respx.get("http://test/api/uploads/canvas/c1_a.png").mock(
        return_value=httpx.Response(200, content=b"\x89PNG\r\n\x1a\n"))
    c = make_client()
    resp = await c.call_bytes("GET", "/api/uploads/canvas/c1_a.png")
    await c.aclose()
    assert resp.content == b"\x89PNG\r\n\x1a\n"


@respx.mock
async def test_call_bytes_maps_failures_like_call_json():
    respx.get("http://test/api/uploads/canvas/c1_a.png").mock(return_value=httpx.Response(404))
    respx.get("http://test/api/uploads/canvas/c1_b.png").mock(return_value=httpx.Response(
        401, json={"status": False, "message": "NEED_LOGIN", "code": "NEED_LOGIN",
                   "category": "auth", "retryable": False}))
    respx.get("http://test/api/uploads/canvas/c1_c.png").mock(side_effect=httpx.ConnectError("boom"))
    c = make_client()
    missing = await c.call_bytes("GET", "/api/uploads/canvas/c1_a.png")
    unauth = await c.call_bytes("GET", "/api/uploads/canvas/c1_b.png")
    down = await c.call_bytes("GET", "/api/uploads/canvas/c1_c.png")
    await c.aclose()
    assert missing["error"]["category"] == "not_found"
    assert (unauth["error"]["category"], unauth["error"]["code"]) == ("auth", "NEED_LOGIN")
    assert down["error"]["category"] == "network"


async def test_call_bytes_without_token_sends_nothing():
    c = make_client(token="")
    out = await c.call_bytes("GET", "/api/uploads/canvas/c1_a.png")
    await c.aclose()
    assert out["error"]["code"] == "TOKEN_NOT_SET"
