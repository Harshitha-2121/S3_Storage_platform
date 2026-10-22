from django.contrib.auth import get_user_model
from apps.organizations_ext.models import Organization
from apps.projects.models import Project, ProjectKey

try:
    from apps.teams.models import Team
except Exception:
    Team = None

User = get_user_model()
email, pw = "admin@myos.test", "MyosAdmin#2026"

u, _ = User.objects.get_or_create(email=email)
u.set_password(pw)
u.is_superuser = True
u.is_staff = True
u.is_active = True
u.save()

org, _ = Organization.objects.get_or_create(name="myos")
try:
    ou = org.add_user(u)
    try:
        org.change_owner(ou)
    except Exception as e:
        print("owner-skip", e)
except Exception as e:
    print("add_user-skip", e)

team = None
if Team is not None:
    team, _ = Team.objects.get_or_create(slug="myos", organization=org)

proj, _ = Project.objects.get_or_create(name="app", organization=org)
if team is not None:
    try:
        proj.teams.add(team)
    except Exception as e:
        print("team-link-skip", e)

pk = ProjectKey.objects.filter(project=proj).first() or ProjectKey.objects.create(project=proj)

print("PUBLIC_KEY=" + str(pk.public_key))
print("PROJECT_ID=" + str(proj.id))
try:
    print("DSN=" + pk.get_dsn())
except Exception as e:
    print("get_dsn-failed", e)
