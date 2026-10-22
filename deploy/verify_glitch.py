for path, cls in [
    ("apps.issue_events.models", "IssueEvent"),
    ("apps.issues.models", "Issue"),
]:
    try:
        mod = __import__(path, fromlist=[cls])
        M = getattr(mod, cls)
        print(cls, "count=", M.objects.count())
    except Exception as e:
        print(cls, "ERR", e)
