#!/usr/bin/env python3
# Repair external-role {title, company} that came through as raw page-<title>
# junk ("page_title", "Job Application for X at Y", "Company - Role") or a hostname
# company ("job-boards.greenhouse.io"). SAFE BY DESIGN: only overrides a field when
# it is provably bad — a clean, hand-curated entry is left untouched (so a profile
# whose `note` holds prose commentary instead of a structured summary is a no-op).
import json, re, sys

def extract(summary):
    s = re.sub(r"\s+", " ", summary or "").strip()
    title = None
    company = None
    m = re.search(r"hiring\s+(?:company|by)[:\s]+([^;.\n)]+)", s, re.I)
    if m: company = m.group(1).strip()
    m = re.search(r"(?:exact\s+)?job\s+title[:\s]+(.+?)(?:\s*;|\s+hiring|$)", s, re.I)
    if m: title = m.group(1).strip()
    if not title:
        head = s
        if company:
            cm = re.search(r"hiring\s+(?:company|by)", s, re.I)
            if cm: head = s[:cm.start()].rstrip(" ;,-—–")
        if company:
            title = head.strip()
            if "," in title:
                before, after = title.split(",", 1)
                if "(" in after or company.lower() in after.lower():
                    title = before.strip()
        else:
            am = re.match(r"^(.+?)\s+at\s+(.+)$", head, re.I)
            dm = re.match(r"^(.+?)\s+[—–]\s+(.+)$", head)
            if am: title, company = am.group(1).strip(), am.group(2)
            elif dm: title, company = dm.group(1).strip(), dm.group(2)
            else:
                c = head.find(",")
                title = (head[:c] if c > 0 else head).strip()
                company = head[c+1:] if c > 0 else None
    title = strip_filler(title)
    if title: title = title.rstrip(" (,;—–-")
    if company:
        company = re.split(r"\s+[—–-]\s+", company)[0]        # drop " - Location"
        company = re.split(r"[;,]", company)[0]               # drop "; New York" / ", City"
        company = re.sub(r"\s*\(.*$", "", company)            # drop "(parenthetical"
        company = company.strip(" ).;:")
    return (title or None), (company or None)

# Pull the role out of the existing title's known page-title wrappers — more reliable
# than a prose note. Greenhouse: "Job Application for {Role} at {Company}".
def role_from_existing(t):
    m = re.match(r"(?i)^job application for (.+?) at .+$", (t or "").strip())
    return m.group(1).strip() if m else None

def strip_filler(t):
    if not t: return t
    return re.sub(r"(?i)^(?:the (?:job|role|position) is(?: for)?(?: the)?|this (?:role|position) is(?: for)?(?: the)?)\s+", "", t.strip())

def is_junk_title(t):
    t = (t or "").strip()
    return (not t) or bool(re.fullmatch(r"page_title|\d+|role", t, re.I)) or len(t) < 3

def is_hostname(s):
    s = (s or "").strip()
    return bool(re.search(r"\.(io|com|org|net|gov|edu)\b", s)) or (("." in s) and (" " not in s) and len(s) > 3)

def is_bad_company(s):
    s = (s or "").strip()
    return (not s) or is_hostname(s) or s.endswith((")", " L")) or bool(re.match(r"(?i)^(based |located |a |an )", s))

def title_is_artifact(title, company):
    t = (title or "").strip()
    if is_junk_title(t): return True
    if re.match(r"(?i)^job application for ", t): return True
    if is_hostname(company): return True          # auto-generated entry → title likely raw too
    if is_bad_company(company): return True
    return False

def main(path):
    data = json.load(open(path))
    items = data if isinstance(data, list) else data.get("results", [])
    changed = 0
    for r in items:
        et, ec = r.get("title", ""), r.get("company", "")
        st, sc = extract(r.get("note", ""))      # summary-derived candidates
        new_title, new_company = et, ec
        if title_is_artifact(et, ec):
            new_title = role_from_existing(et) or st or (et if not is_junk_title(et) else "Role")
        if is_bad_company(ec):
            new_company = sc or (ec if not is_hostname(ec) else None) or ec
        if new_title != et or new_company != ec:
            changed += 1
            print(f"  fixed: {et!r} -> {new_title!r}  |  {ec!r} -> {new_company!r}")
    # second pass writes (kept separate so the dry-run print above is faithful)
    for r in items:
        et, ec = r.get("title", ""), r.get("company", "")
        st, sc = extract(r.get("note", ""))
        if title_is_artifact(et, ec):
            r["title"] = role_from_existing(et) or st or (et if not is_junk_title(et) else "Role")
        if is_bad_company(ec):
            r["company"] = sc or (ec if not is_hostname(ec) else None) or ec
    json.dump(items, open(path, "w"), indent=2)
    print(f"{changed} of {len(items)} entries updated")

if __name__ == "__main__":
    main(sys.argv[1])
