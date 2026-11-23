"""Start the layer workflows when the layers bucket has changed.

GitHub runs `schedule` workflows hours late, so the matrix lagged behind
the modules. This is a Yandex Cloud Function on a timer in the cloud that
owns the layers bucket. Each tick makes one request: the listing of
`layers/`. GitHub is called only if a file changed since the previous
tick, and for the options workflow, whose database lives in another
bucket, at two fixed times a day.

The function keeps no state: "changed" means modified within LOOKBACK,
which is the timer interval plus a margin. A tick that lands inside the
margin starts one extra run, and that run commits nothing.

Environment: GITHUB_TOKEN (fine-grained, Actions read and write on the
repository), GITHUB_REPO, LAYERS_BUCKET. The bucket is listed with the
IAM token of the function's service account.
"""

import datetime as dt
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

STORAGE_URL = "https://storage.yandexcloud.net"
GITHUB_API = "https://api.github.com"
PREFIX = "layers/"
TICK_MINUTES = 20  # the timer fires at :05, :25 and :45
LOOKBACK = dt.timedelta(minutes=TICK_MINUTES + 2)
SYNC_WORKFLOW = "sync-layers.yml"
OPTIONS_WORKFLOW = "update-options.yml"
# The options database is refreshed around 04:00 UTC; the second run covers a late refresh.
OPTIONS_HOURS = (4, 8)
OPTIONS_MINUTE = 45
TIMEOUT_SEC = 10


def parse_listing(body):
    """{key: modification time} from a ListObjectsV2 response."""
    modified = {}
    for node in ET.fromstring(body).iter():
        if node.tag.rpartition("}")[2] != "Contents":
            continue
        fields = {child.tag.rpartition("}")[2]: child.text for child in node}
        stamp = dt.datetime.fromisoformat(fields["LastModified"].replace("Z", "+00:00"))
        modified[fields["Key"]] = stamp
    return modified


def changed_keys(modified, now, lookback=LOOKBACK):
    """Keys written since the previous tick."""
    return sorted(key for key, stamp in modified.items() if now - stamp < lookback)


def options_due(now):
    """True on the one tick of each options hour."""
    return (now.hour in OPTIONS_HOURS
            and OPTIONS_MINUTE <= now.minute < OPTIONS_MINUTE + TICK_MINUTES)


def workflows_due(modified, now):
    due = []
    if changed_keys(modified, now):
        due.append(SYNC_WORKFLOW)
    if options_due(now):
        due.append(OPTIONS_WORKFLOW)
    return due


def list_layers(bucket, iam_token):
    query = urllib.parse.urlencode({"list-type": "2", "prefix": PREFIX})
    request = urllib.request.Request(
        f"{STORAGE_URL}/{urllib.parse.quote(bucket)}?{query}",
        headers={"X-YaCloud-SubjectToken": iam_token})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
        return parse_listing(response.read())


def dispatch(repo, workflow, token):
    request = urllib.request.Request(
        f"{GITHUB_API}/repos/{repo}/actions/workflows/{workflow}/dispatches",
        data=json.dumps({"ref": "main"}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "InvestroLog-Sync-Trigger/1.0",
        })
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    if status != 204:
        raise RuntimeError(f"{workflow}: GitHub answered {status}")


def handler(event, context):
    now = dt.datetime.now(dt.timezone.utc)
    modified = list_layers(os.environ["LAYERS_BUCKET"], context.token["access_token"])
    due = workflows_due(modified, now)
    for workflow in due:
        dispatch(os.environ["GITHUB_REPO"], workflow, os.environ["GITHUB_TOKEN"])
    print(f"layers: {len(modified)}, changed: {changed_keys(modified, now)}, started: {due}")
    return {"statusCode": 200, "body": json.dumps({"started": due})}
