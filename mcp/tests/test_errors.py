from weave_mcp.errors import (
    make_error, CATEGORIES, RETRYABLE, MCP_LOCAL_CODES,
    TOKEN_NOT_SET, WEEKEND_NO_CELL, MCP_TOOL_EXCEPTION,
    BRANCH_KEY_NOT_FOUND, INVALID_BRANCH_REF,
    USER_REF_NOT_FOUND, USER_REF_AMBIGUOUS, INVALID_USER_REF,
    category_for_code,
    error_from_body, error_from_status, normalize_embedded, WORKSPACE_TZ_UNAVAILABLE,
)


def test_make_error_core_keys_always_present():
    out = make_error("forbidden", code="ADMIN_REQUIRED", message="nope", http_status=401)
    assert out == {"error": {
        "category": "forbidden", "code": "ADMIN_REQUIRED", "message": "nope",
        "http_status": 401, "retryable": False, "retry_after": None,
    }}


def test_make_error_retryable_derived_from_category():
    assert make_error("network")["error"]["retryable"] is True
    assert make_error("server")["error"]["retryable"] is True
    assert make_error("rate_limited")["error"]["retryable"] is True
    assert make_error("validation")["error"]["retryable"] is False


def test_make_error_explicit_retryable_wins_over_derivation():
    # backend body said retryable=True for a normally-non-retryable category
    assert make_error("business", retryable=True)["error"]["retryable"] is True


def test_make_error_unknown_category_falls_back_to_business():
    assert make_error("nonsense")["error"]["category"] == "business"


def test_make_error_extra_keys_pass_through_when_present():
    out = make_error("validation", code="INVALID_FILTER", detail="bad: [12]")
    assert out["error"]["detail"] == "bad: [12]"


def test_make_error_reserved_extra_keys_are_dropped():
    out = make_error("business", status=False, message="m", code="C")
    # status/message/code handled via named params or dropped; never duplicated as junk
    assert "status" not in out["error"]


def test_make_error_none_extra_omitted():
    out = make_error("auth", code=TOKEN_NOT_SET, detail=None)
    assert "detail" not in out["error"]


def test_constants_shape():
    assert CATEGORIES == frozenset({
        "auth", "forbidden", "not_found", "validation",
        "conflict", "rate_limited", "network", "server", "business",
    })
    assert RETRYABLE == frozenset({"network", "server", "rate_limited"})
    assert MCP_LOCAL_CODES == frozenset({
        TOKEN_NOT_SET, WEEKEND_NO_CELL, MCP_TOOL_EXCEPTION,
        BRANCH_KEY_NOT_FOUND, INVALID_BRANCH_REF,
        USER_REF_NOT_FOUND, USER_REF_AMBIGUOUS, INVALID_USER_REF,
        WORKSPACE_TZ_UNAVAILABLE,
    })


def test_category_for_code_suffix_rules():
    assert category_for_code("BRANCH_NOT_FOUND") == "not_found"
    assert category_for_code("NOT_BRANCH_MEMBER") == "forbidden"
    assert category_for_code("NOT_ANNOTATION_AUTHOR") == "forbidden"
    assert category_for_code("INVALID_STATUS") == "validation"
    assert category_for_code("FILE_TOO_LARGE") == "validation"
    assert category_for_code("STATUS_IN_USE") == "conflict"
    assert category_for_code("KEY_ALREADY_EXISTS") == "conflict"


def test_category_for_code_overrides():
    assert category_for_code("ADMIN_ONLY") == "forbidden"
    assert category_for_code("ACCESS_DENIED") == "forbidden"
    assert category_for_code("CIRCULAR_DEPENDENCY") == "conflict"
    assert category_for_code("RATE_LIMIT_EXCEEDED") == "rate_limited"
    assert category_for_code("INTERNAL_SERVER_ERROR") == "server"


def test_category_for_code_unknown_is_business():
    assert category_for_code("TOTALLY_MADE_UP") == "business"
    assert category_for_code(None) == "business"


def test_error_from_body_trusts_body_category_over_anything():
    # ADMIN_REQUIRED arrives under HTTP 401 but body says forbidden
    body = {"status": False, "message": "ADMIN_REQUIRED", "code": "ADMIN_REQUIRED",
            "category": "forbidden", "retryable": False}
    out = error_from_body(body, 401)["error"]
    assert out["category"] == "forbidden"
    assert out["code"] == "ADMIN_REQUIRED"
    assert out["http_status"] == 401
    assert out["retryable"] is False


def test_error_from_body_need_login_is_auth():
    body = {"status": False, "message": "NEED_LOGIN", "code": "NEED_LOGIN",
            "category": "auth", "retryable": False}
    assert error_from_body(body, 401)["error"]["category"] == "auth"


def test_error_from_body_preserves_detail_extra():
    body = {"status": False, "message": "INVALID_FILTER", "code": "INVALID_FILTER",
            "category": "validation", "retryable": False, "detail": "custom fields: [12]"}
    out = error_from_body(body, 200)["error"]
    assert out["detail"] == "custom fields: [12]"
    assert out["category"] == "validation"


def test_error_from_body_no_category_uses_resolver():
    # legacy categoryless body (code-only)
    body = {"status": False, "message": "NOT_CANVAS_MEMBER"}
    out = error_from_body(body, 200)["error"]
    assert out["category"] == "forbidden"
    assert out["code"] == "NOT_CANVAS_MEMBER"


def test_error_from_body_free_text_message_is_not_a_code():
    body = {"status": False, "message": "something went wrong, try again"}
    out = error_from_body(body, 200)["error"]
    assert out["code"] is None
    assert out["message"] == "something went wrong, try again"
    assert out["category"] == "business"


def test_error_from_body_free_text_non_2xx_uses_status_category():
    # non-2xx free-text (no code, no category) → transport status drives the category
    assert error_from_body({"message": "Not found"}, 404)["error"]["category"] == "not_found"
    assert error_from_body({"message": "slow down"}, 429)["error"]["category"] == "rate_limited"
    # ...but a 200 status:false free-text body stays business
    assert error_from_body({"status": False, "message": "oops"}, 200)["error"]["category"] == "business"


def test_error_from_body_missing_message_never_stores_whole_dict():
    body = {"status": False, "weird": 1}
    out = error_from_body(body, 200)["error"]
    assert out["message"] is None
    assert out["code"] is None
    assert out["category"] == "business"
    assert out["weird"] == 1  # non-reserved extra passes through


def test_error_from_status_maps_known_statuses():
    assert error_from_status(404)["error"]["category"] == "not_found"
    assert error_from_status(422, detail=[{"loc": ["x"]}])["error"]["category"] == "validation"
    assert error_from_status(422, detail=[{"loc": ["x"]}])["error"]["detail"] == [{"loc": ["x"]}]
    assert error_from_status(429)["error"]["category"] == "rate_limited"
    assert error_from_status(429)["error"]["retryable"] is True
    assert error_from_status(503)["error"]["category"] == "server"
    assert error_from_status(418)["error"]["category"] == "business"


def test_normalize_embedded_idempotent_for_canonical():
    canonical = {"error": {"category": "business", "code": "X", "message": None,
                           "http_status": 200, "retryable": False, "retry_after": None}}
    assert normalize_embedded(canonical, 200) == canonical


def test_normalize_embedded_lifts_flat_error():
    body = {"error": {"status": False, "code": "NOT_BRANCH_MEMBER",
                      "category": "forbidden", "retryable": False}}
    out = normalize_embedded(body, 200)["error"]
    assert out["category"] == "forbidden"
    assert out["code"] == "NOT_BRANCH_MEMBER"
    assert {"category", "code", "message", "http_status", "retryable", "retry_after"} <= out.keys()
    assert "status" not in out


def test_error_from_body_body_retry_after_key_does_not_collide():
    out = error_from_body({"status": False, "message": "slow", "retry_after": 12}, 200)["error"]
    assert out["retry_after"] is None            # header/transport param wins; body key dropped
    assert {"category", "code", "message", "http_status", "retryable", "retry_after"} <= out.keys()


def test_error_from_body_body_http_status_key_does_not_collide():
    out = error_from_body({"status": False, "message": "x", "http_status": 999}, 200)["error"]
    assert out["http_status"] == 200             # transport status wins; body key dropped
    assert isinstance(out["retryable"], bool)


def test_make_error_non_bool_retryable_derives_from_category():
    assert make_error("business", retryable="false")["error"]["retryable"] is False   # not bool("false")==True
    assert make_error("network", retryable="x")["error"]["retryable"] is True          # derives from category


def test_normalize_embedded_reshapes_partial_embedded_error():
    out = normalize_embedded({"error": {"category": "forbidden", "retryable": False}}, 200)["error"]
    assert {"category", "code", "message", "http_status", "retryable", "retry_after"} <= out.keys()
    assert out["category"] == "forbidden" and out["http_status"] == 200


def test_normalize_embedded_reshapes_non_bool_retryable():
    src = {"category": "forbidden", "retryable": "no", "code": None, "message": None,
           "http_status": None, "retry_after": None}
    assert isinstance(normalize_embedded({"error": src}, 200)["error"]["retryable"], bool)
