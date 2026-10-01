"""Central error vocabulary for the Weave backend.

One place that maps each error code to its category and retryability, plus the
builder that produces the unified failure body. Failures are RETURNED (not raised)
as HTTP-200 dicts:

    {"status": False, "message": CODE, "code": CODE, "category": ..., "retryable": ...}

The legacy "message" key is kept (dual-emit) so existing clients/frontend that read
`message` keep working during the migration (SP-2/SP-3); new clients read
`code`/`category`/`retryable`.
"""
from enum import Enum


class Category(str, Enum):
    AUTH = "auth"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    VALIDATION = "validation"
    CONFLICT = "conflict"
    RATE_LIMITED = "rate_limited"
    NETWORK = "network"  # transport-layer only (MCP client, SP-3) — no backend ErrorCode emits this
    SERVER = "server"
    BUSINESS = "business"


RETRYABLE_CATEGORIES = frozenset({Category.RATE_LIMITED, Category.NETWORK, Category.SERVER})


class ErrorCode(str, Enum):
    """A code string that also carries its category + retryability.

    `ErrorCode.X == "X"` (it IS a str), so it serializes to JSON as the bare code
    and compares equal to the legacy string literals.
    """

    def __new__(cls, code: str, category: "Category"):
        obj = str.__new__(cls, code)
        obj._value_ = code
        obj.category = category
        obj.retryable = category in RETRYABLE_CATEGORIES
        return obj

    # --- auth ---------------------------------------------------------------
    ACCOUNT_INACTIVE = ("ACCOUNT_INACTIVE", Category.AUTH)
    ACCOUNT_PENDING = ("ACCOUNT_PENDING", Category.AUTH)
    ACCOUNT_REJECTED = ("ACCOUNT_REJECTED", Category.AUTH)
    INVALID_CREDENTIALS = ("INVALID_CREDENTIALS", Category.AUTH)
    INVALID_OR_EXPIRED_TOKEN = ("INVALID_OR_EXPIRED_TOKEN", Category.AUTH)
    NEED_LOGIN = ("NEED_LOGIN", Category.AUTH)  # handler (401)

    # --- forbidden ----------------------------------------------------------
    PERMISSION_DENIED = ("PERMISSION_DENIED", Category.FORBIDDEN)  # canonical of admin_permission_denied
    ADMIN_ONLY = ("ADMIN_ONLY", Category.FORBIDDEN)
    ACCESS_DENIED = ("ACCESS_DENIED", Category.FORBIDDEN)
    NOT_ALLOWED = ("NOT_ALLOWED", Category.FORBIDDEN)
    ADMIN_REQUIRED = ("ADMIN_REQUIRED", Category.FORBIDDEN)  # handler (401, but a permission failure)
    NOT_AUTHOR = ("NOT_AUTHOR", Category.FORBIDDEN)  # canonical of not_author
    NOT_ANNOTATION_AUTHOR = ("NOT_ANNOTATION_AUTHOR", Category.FORBIDDEN)
    NOT_REPLY_AUTHOR = ("NOT_REPLY_AUTHOR", Category.FORBIDDEN)
    NOT_COMMENT_AUTHOR = ("NOT_COMMENT_AUTHOR", Category.FORBIDDEN)
    NOT_ISSUE_AUTHOR = ("NOT_ISSUE_AUTHOR", Category.FORBIDDEN)
    NOT_A_MEMBER = ("NOT_A_MEMBER", Category.FORBIDDEN)  # canonical of not_member
    NOT_BRANCH_MEMBER = ("NOT_BRANCH_MEMBER", Category.FORBIDDEN)
    NOT_CANVAS_MEMBER = ("NOT_CANVAS_MEMBER", Category.FORBIDDEN)
    NOT_BOARD_MEMBER = ("NOT_BOARD_MEMBER", Category.FORBIDDEN)
    NOT_TRACK_MEMBER = ("NOT_TRACK_MEMBER", Category.FORBIDDEN)
    NOT_SCOPE_BRANCH_MEMBER = ("NOT_SCOPE_BRANCH_MEMBER", Category.FORBIDDEN)
    NOT_VIEW_OWNER = ("NOT_VIEW_OWNER", Category.FORBIDDEN)
    NOT_VIEW_VISIBLE = ("NOT_VIEW_VISIBLE", Category.FORBIDDEN)
    SCOPE_BRANCH_NOT_PARTICIPATING = ("SCOPE_BRANCH_NOT_PARTICIPATING", Category.FORBIDDEN)
    NOT_PUBLIC = ("NOT_PUBLIC", Category.FORBIDDEN)  # canonical of not_public (new)
    BRANCH_NOT_PUBLIC = ("BRANCH_NOT_PUBLIC", Category.FORBIDDEN)
    CANVAS_NOT_PUBLIC = ("CANVAS_NOT_PUBLIC", Category.FORBIDDEN)

    # --- not_found ----------------------------------------------------------
    AFTER_TASK_NOT_FOUND = ("AFTER_TASK_NOT_FOUND", Category.NOT_FOUND)
    ANNOTATION_NOT_FOUND = ("ANNOTATION_NOT_FOUND", Category.NOT_FOUND)
    BOARD_NOT_FOUND = ("BOARD_NOT_FOUND", Category.NOT_FOUND)
    BRANCH_NOT_FOUND = ("BRANCH_NOT_FOUND", Category.NOT_FOUND)
    CANVAS_NOT_FOUND = ("CANVAS_NOT_FOUND", Category.NOT_FOUND)
    COMMENT_NOT_FOUND = ("COMMENT_NOT_FOUND", Category.NOT_FOUND)
    EPIC_NOT_FOUND = ("EPIC_NOT_FOUND", Category.NOT_FOUND)
    EVENT_NOT_FOUND = ("EVENT_NOT_FOUND", Category.NOT_FOUND)
    FIELD_NOT_FOUND = ("FIELD_NOT_FOUND", Category.NOT_FOUND)
    INTEGRATION_NOT_FOUND = ("INTEGRATION_NOT_FOUND", Category.NOT_FOUND)
    ISSUE_NOT_FOUND = ("ISSUE_NOT_FOUND", Category.NOT_FOUND)
    ITEM_NOT_FOUND = ("ITEM_NOT_FOUND", Category.NOT_FOUND)
    LABEL_NOT_FOUND = ("LABEL_NOT_FOUND", Category.NOT_FOUND)
    MEMBER_NOT_FOUND = ("MEMBER_NOT_FOUND", Category.NOT_FOUND)
    NOT_FOUND_OR_NOT_OWNER = ("NOT_FOUND_OR_NOT_OWNER", Category.NOT_FOUND)
    PAGE_NOT_FOUND = ("PAGE_NOT_FOUND", Category.NOT_FOUND)
    PARENT_NOT_FOUND = ("PARENT_NOT_FOUND", Category.NOT_FOUND)
    PARENT_PAGE_NOT_FOUND = ("PARENT_PAGE_NOT_FOUND", Category.NOT_FOUND)
    REF_NOT_FOUND = ("REF_NOT_FOUND", Category.NOT_FOUND)  # github 수동 ref unlink/update 시 ref가 task에 없음
    REPLY_NOT_FOUND = ("REPLY_NOT_FOUND", Category.NOT_FOUND)
    RETRO_NOT_FOUND = ("RETRO_NOT_FOUND", Category.NOT_FOUND)
    SCOPE_NOT_FOUND = ("SCOPE_NOT_FOUND", Category.NOT_FOUND)
    SPRINT_NOT_FOUND = ("SPRINT_NOT_FOUND", Category.NOT_FOUND)
    STATUS_NOT_FOUND = ("STATUS_NOT_FOUND", Category.NOT_FOUND)
    TARGET_SPRINT_NOT_FOUND = ("TARGET_SPRINT_NOT_FOUND", Category.NOT_FOUND)
    TASK_NOT_FOUND = ("TASK_NOT_FOUND", Category.NOT_FOUND)
    TOKEN_NOT_FOUND = ("TOKEN_NOT_FOUND", Category.NOT_FOUND)
    TRACK_NOT_FOUND = ("TRACK_NOT_FOUND", Category.NOT_FOUND)
    TYPE_NOT_FOUND = ("TYPE_NOT_FOUND", Category.NOT_FOUND)
    USER_NOT_FOUND = ("USER_NOT_FOUND", Category.NOT_FOUND)
    VIEW_NOT_FOUND = ("VIEW_NOT_FOUND", Category.NOT_FOUND)

    # --- validation ---------------------------------------------------------
    AMBIGUOUS_STATUS = ("AMBIGUOUS_STATUS", Category.VALIDATION)  # label 다중 매치 (status ref ingress)
    AMBIGUOUS_TASK_TYPE = ("AMBIGUOUS_TASK_TYPE", Category.VALIDATION)  # type_name 다중 매치
    CSV_FILE_REQUIRED = ("CSV_FILE_REQUIRED", Category.VALIDATION)
    CSV_PARSE_ERROR = ("CSV_PARSE_ERROR", Category.VALIDATION)
    DM_REQUIRES_ONE_MEMBER = ("DM_REQUIRES_ONE_MEMBER", Category.VALIDATION)
    FILE_TOO_LARGE = ("FILE_TOO_LARGE", Category.VALIDATION)
    INVALID_ASSIGNEE = ("INVALID_ASSIGNEE", Category.VALIDATION)
    INVALID_BUCKET = ("INVALID_BUCKET", Category.VALIDATION)
    INVALID_CELL = ("INVALID_CELL", Category.VALIDATION)
    INVALID_CURRENT_PASSWORD = ("INVALID_CURRENT_PASSWORD", Category.VALIDATION)
    INVALID_CUSTOM_FIELD = ("INVALID_CUSTOM_FIELD", Category.VALIDATION)
    INVALID_DATE = ("INVALID_DATE", Category.VALIDATION)  # router-inline (scrum_retro)
    INVALID_DATE_RANGE = ("INVALID_DATE_RANGE", Category.VALIDATION)
    INVALID_DEP_TYPE = ("INVALID_DEP_TYPE", Category.VALIDATION)
    INVALID_ENDPOINT = ("INVALID_ENDPOINT", Category.VALIDATION)
    INVALID_FILE_CONTENT = ("INVALID_FILE_CONTENT", Category.VALIDATION)
    INVALID_FILE_TYPE = ("INVALID_FILE_TYPE", Category.VALIDATION)
    INVALID_FILTER = ("INVALID_FILTER", Category.VALIDATION)
    INVALID_GITHUB_URL = ("INVALID_GITHUB_URL", Category.VALIDATION)  # PR URL이 github.com/{owner}/{repo}/pull/{n} 형식이 아님
    INVALID_ITEM_TYPE = ("INVALID_ITEM_TYPE", Category.VALIDATION)
    INVALID_MIGRATION_ID = ("INVALID_MIGRATION_ID", Category.VALIDATION)
    INVALID_MOVE_TARGET = ("INVALID_MOVE_TARGET", Category.VALIDATION)
    INVALID_PARENT = ("INVALID_PARENT", Category.VALIDATION)
    INVALID_SCOPE = ("INVALID_SCOPE", Category.VALIDATION)
    INVALID_STATUS = ("INVALID_STATUS", Category.VALIDATION)
    INVALID_TASK_TYPE = ("INVALID_TASK_TYPE", Category.VALIDATION)
    INVALID_VISIBILITY = ("INVALID_VISIBILITY", Category.VALIDATION)     # 잘못된 visibility 값
    NO_FILE = ("NO_FILE", Category.VALIDATION)
    PARENT_SELF = ("PARENT_SELF", Category.VALIDATION)
    PASSWORD_MISMATCH = ("PASSWORD_MISMATCH", Category.VALIDATION)
    PASSWORD_TOO_SHORT = ("PASSWORD_TOO_SHORT", Category.VALIDATION)
    REPO_NOT_CONNECTED = ("REPO_NOT_CONNECTED", Category.VALIDATION)  # 수동 링크 대상 repo가 이 브랜치에 연결돼 있지 않음
    REQUEST_TOO_LARGE = ("REQUEST_TOO_LARGE", Category.VALIDATION)  # handler (413)
    SELF_REFERENCE = ("SELF_REFERENCE", Category.VALIDATION)  # canonical of self_reference (new)
    SELF_DEPENDENCY = ("SELF_DEPENDENCY", Category.VALIDATION)
    SELF_LINK = ("SELF_LINK", Category.VALIDATION)
    SMTP_PASSWORD_REQUIRED = ("SMTP_PASSWORD_REQUIRED", Category.VALIDATION)
    VIEW_SCOPE_MISMATCH = ("VIEW_SCOPE_MISMATCH", Category.VALIDATION)   # 쿼리 시 뷰 스코프 불일치

    # --- conflict -----------------------------------------------------------
    ALREADY_INITIALIZED = ("ALREADY_INITIALIZED", Category.CONFLICT)
    ALREADY_LINKED = ("ALREADY_LINKED", Category.CONFLICT)
    ALREADY_MEMBER = ("ALREADY_MEMBER", Category.CONFLICT)
    COMMENT_DELETED = ("COMMENT_DELETED", Category.CONFLICT)
    DEPENDENCY_CYCLE = ("DEPENDENCY_CYCLE", Category.CONFLICT)  # canonical of dependency_cycle (new)
    CIRCULAR_DEPENDENCY = ("CIRCULAR_DEPENDENCY", Category.CONFLICT)
    PARENT_CYCLE = ("PARENT_CYCLE", Category.CONFLICT)
    DUPLICATE_DEPENDENCY = ("DUPLICATE_DEPENDENCY", Category.CONFLICT)
    DUPLICATE_LINK = ("DUPLICATE_LINK", Category.CONFLICT)
    INVALID_STATUS_TRANSITION = ("INVALID_STATUS_TRANSITION", Category.CONFLICT)  # 원자적 전이 0행(선조건 불일치/경쟁 패배)
    EMAIL_ALREADY_EXISTS = ("EMAIL_ALREADY_EXISTS", Category.CONFLICT)
    KEY_ALREADY_EXISTS = ("KEY_ALREADY_EXISTS", Category.CONFLICT)  # canonical of key_already_exists
    TYPE_KEY_ALREADY_EXISTS = ("TYPE_KEY_ALREADY_EXISTS", Category.CONFLICT)
    LABEL_ALREADY_EXISTS = ("LABEL_ALREADY_EXISTS", Category.CONFLICT)
    PAGE_BEING_EDITED = ("PAGE_BEING_EDITED", Category.CONFLICT)  # 공동편집 중인 캔버스 페이지에 편집기 밖 본문 쓰기(CV-02)
    PARENT_DELETED = ("PARENT_DELETED", Category.CONFLICT)
    IN_USE = ("IN_USE", Category.CONFLICT)  # canonical of in_use (new)
    STATUS_IN_USE = ("STATUS_IN_USE", Category.CONFLICT)
    TYPE_IN_USE = ("TYPE_IN_USE", Category.CONFLICT)

    # --- business -----------------------------------------------------------
    CANNOT_MODIFY_SELF = ("CANNOT_MODIFY_SELF", Category.BUSINESS)  # canonical of cannot_modify_self (new)
    CANNOT_CHANGE_OWN_ROLE = ("CANNOT_CHANGE_OWN_ROLE", Category.BUSINESS)
    CANNOT_CHANGE_OWN_STATUS = ("CANNOT_CHANGE_OWN_STATUS", Category.BUSINESS)
    CANNOT_RESET_OWN_PASSWORD = ("CANNOT_RESET_OWN_PASSWORD", Category.BUSINESS)
    CANNOT_DELETE_SELF = ("CANNOT_DELETE_SELF", Category.BUSINESS)
    CANNOT_COPY_THIS_TYPE = ("CANNOT_COPY_THIS_TYPE", Category.BUSINESS)
    CANNOT_DELETE_LAST_STATUS = ("CANNOT_DELETE_LAST_STATUS", Category.BUSINESS)
    CANNOT_DELETE_LAST_TYPE = ("CANNOT_DELETE_LAST_TYPE", Category.BUSINESS)
    OVERVIEW_IMMUTABLE = ("OVERVIEW_IMMUTABLE", Category.BUSINESS)  # canonical of overview_immutable (new)
    CANNOT_DELETE_OVERVIEW = ("CANNOT_DELETE_OVERVIEW", Category.BUSINESS)
    CANNOT_MOVE_OVERVIEW = ("CANNOT_MOVE_OVERVIEW", Category.BUSINESS)
    LAST_ADMIN = ("LAST_ADMIN", Category.BUSINESS)  # canonical of last_admin
    CANNOT_LEAVE_LAST_ADMIN = ("CANNOT_LEAVE_LAST_ADMIN", Category.BUSINESS)
    CANNOT_REMOVE_LAST_ADMIN = ("CANNOT_REMOVE_LAST_ADMIN", Category.BUSINESS)
    LAST_OWNER = ("LAST_OWNER", Category.BUSINESS)  # canonical of last_owner
    CANNOT_LEAVE_LAST_OWNER = ("CANNOT_LEAVE_LAST_OWNER", Category.BUSINESS)
    MIGRATION_EXPIRED = ("MIGRATION_EXPIRED", Category.BUSINESS)
    NOT_INITIALIZED = ("NOT_INITIALIZED", Category.BUSINESS)
    PARENT_NOT_TOP_LEVEL = ("PARENT_NOT_TOP_LEVEL", Category.BUSINESS)
    SPRINT_EMPTY = ("SPRINT_EMPTY", Category.BUSINESS)
    SPRINT_NOT_ACTIVE = ("SPRINT_NOT_ACTIVE", Category.BUSINESS)
    SPRINT_NOT_FUTURE = ("SPRINT_NOT_FUTURE", Category.BUSINESS)
    TARGET_HAS_SUBTASKS = ("TARGET_HAS_SUBTASKS", Category.BUSINESS)

    # --- server -------------------------------------------------------------
    AI_NOT_CONFIGURED = ("AI_NOT_CONFIGURED", Category.SERVER)
    GITHUB_FETCH_FAILED = ("GITHUB_FETCH_FAILED", Category.SERVER)  # GitHub PR 메타 조회 실패(네트워크/권한/404)
    MIGRATION_FAILED = ("MIGRATION_FAILED", Category.SERVER)
    SMTP_NOT_CONFIGURED = ("SMTP_NOT_CONFIGURED", Category.SERVER)
    INTERNAL_SERVER_ERROR = ("INTERNAL_SERVER_ERROR", Category.SERVER)  # handler (500)

    # --- rate_limited -------------------------------------------------------
    RATE_LIMIT_EXCEEDED = ("RATE_LIMIT_EXCEEDED", Category.RATE_LIMITED)  # handler (429)


# Deprecated code -> canonical ErrorCode. Consulted by the follow-on controller
# migration (SP-1 bulk) to collapse true synonyms; NOT applied here. Deprecated
# members stay registered until every call site is migrated, then are pruned.
SYNONYMS: dict[str, "ErrorCode"] = {
    "ADMIN_ONLY": ErrorCode.PERMISSION_DENIED,
    "ACCESS_DENIED": ErrorCode.PERMISSION_DENIED,
    "NOT_ALLOWED": ErrorCode.PERMISSION_DENIED,
    "NOT_ANNOTATION_AUTHOR": ErrorCode.NOT_AUTHOR,
    "NOT_REPLY_AUTHOR": ErrorCode.NOT_AUTHOR,
    "NOT_COMMENT_AUTHOR": ErrorCode.NOT_AUTHOR,
    "NOT_ISSUE_AUTHOR": ErrorCode.NOT_AUTHOR,
    "CANNOT_LEAVE_LAST_ADMIN": ErrorCode.LAST_ADMIN,
    "CANNOT_REMOVE_LAST_ADMIN": ErrorCode.LAST_ADMIN,
    "CANNOT_LEAVE_LAST_OWNER": ErrorCode.LAST_OWNER,
    "CANNOT_CHANGE_OWN_ROLE": ErrorCode.CANNOT_MODIFY_SELF,
    "CANNOT_CHANGE_OWN_STATUS": ErrorCode.CANNOT_MODIFY_SELF,
    "CANNOT_RESET_OWN_PASSWORD": ErrorCode.CANNOT_MODIFY_SELF,
    "CANNOT_DELETE_SELF": ErrorCode.CANNOT_MODIFY_SELF,
    "CANNOT_DELETE_OVERVIEW": ErrorCode.OVERVIEW_IMMUTABLE,
    "CANNOT_MOVE_OVERVIEW": ErrorCode.OVERVIEW_IMMUTABLE,
    "TYPE_KEY_ALREADY_EXISTS": ErrorCode.KEY_ALREADY_EXISTS,
    "BRANCH_NOT_PUBLIC": ErrorCode.NOT_PUBLIC,
    "CANVAS_NOT_PUBLIC": ErrorCode.NOT_PUBLIC,
    "CIRCULAR_DEPENDENCY": ErrorCode.DEPENDENCY_CYCLE,
    "PARENT_CYCLE": ErrorCode.DEPENDENCY_CYCLE,
    "SELF_DEPENDENCY": ErrorCode.SELF_REFERENCE,
    "SELF_LINK": ErrorCode.SELF_REFERENCE,
    "STATUS_IN_USE": ErrorCode.IN_USE,
    "TYPE_IN_USE": ErrorCode.IN_USE,
    # NOTE: NOT_*_MEMBER and *_NOT_FOUND are deliberately NOT collapsed here —
    # the resource type is load-bearing for client/UI routing. The bulk-migration
    # plan decides whether to keep distinct codes (same category) or collapse to
    # NOT_A_MEMBER / NOT_FOUND + a `resource` field. See the spec's open decisions.
}


def category_of(code) -> Category:
    """Category for a code (ErrorCode or raw string). BUSINESS for unknown."""
    if isinstance(code, ErrorCode):
        return code.category
    try:
        return ErrorCode(code).category
    except ValueError:
        return Category.BUSINESS


def is_retryable(code) -> bool:
    return category_of(code) in RETRYABLE_CATEGORIES


_RESERVED_KEYS = frozenset({"status", "message", "code", "category", "retryable"})


def error_response(code, **extra) -> dict:
    """Build the unified failure body. `code` may be an ErrorCode or a raw string.

    Always includes the legacy `message` (== code) for dual-emit. Extra kwargs
    (e.g. resource="branch") add context fields and must NOT collide with the
    reserved keys — passing one raises ValueError so dual-emit and the body
    invariants can't be silently broken by a caller.
    """
    clash = _RESERVED_KEYS & extra.keys()
    if clash:
        raise ValueError(
            f"error_response: reserved keys cannot be overridden: {sorted(clash)}"
        )
    code_str = code.value if isinstance(code, ErrorCode) else str(code)
    cat = category_of(code)
    body = {
        "status": False,
        "message": code_str,
        "code": code_str,
        "category": cat.value,
        "retryable": cat in RETRYABLE_CATEGORIES,
    }
    body.update(extra)
    return body
