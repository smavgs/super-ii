class SuperiiError(RuntimeError):
    """An actionable acquisition, verification or execution failure."""


class IntegrityError(SuperiiError):
    """An object or manifest did not match its immutable identity."""


class PlanError(SuperiiError):
    """No supported configuration fits the detected machine."""
