from django.apps import apps

for m in apps.get_models():
    n = m.__name__
    if any(k in n for k in ["Project", "Organization", "Team", "User", "Key"]):
        print(f"{m._meta.app_label}.{n}  module={m.__module__}")
