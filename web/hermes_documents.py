import os
import io
import re
import smtplib
from datetime import datetime
from dotenv import load_dotenv

from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

from flask import Blueprint, request, jsonify, send_file
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle)
from reportlab.lib.enums import TA_LEFT

documents_bp = Blueprint("documents", __name__)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


# ==================== REPORT STYLING ====================

INK    = colors.HexColor("#12161C")
MUTED  = colors.HexColor("#5B6572")
RULE   = colors.HexColor("#D6DCE3")
BAND   = colors.HexColor("#0E1721")
ACCENT = colors.HexColor("#0E6E8C")
SOFT   = colors.HexColor("#F2F5F8")

SEVERITY_COLOURS = {
    "CRITICAL": colors.HexColor("#B3261E"),
    "HIGH":     colors.HexColor("#C4571B"),
    "MEDIUM":   colors.HexColor("#B8860B"),
    "LOW":      colors.HexColor("#1E7B4D"),
}

# Section headings SIRA and Hermes emit. The report body is split on these so
# the PDF can lay them out as real sections instead of one flat run of text.
SECTION_NAMES = [
    "SUMMARY", "OVERVIEW", "THREAT DETAILS", "TOP THREATS", "PATTERNS DETECTED",
    "WHAT THIS MEANS", "ENDPOINT SECURITY", "RISK LEVEL", "RISK ASSESSMENT",
    "CVE IMPACT", "SITUATION", "RECOMMENDED ACTIONS", "PRIORITY ACTIONS",
    "IMMEDIATE ACTIONS",
]

ACTION_SECTIONS = {"RECOMMENDED ACTIONS", "PRIORITY ACTIONS", "IMMEDIATE ACTIONS"}

_styles = getSampleStyleSheet()
ST = {
    "title": ParagraphStyle("t", parent=_styles["Title"], fontSize=19, leading=23,
                            alignment=TA_LEFT, textColor=INK, spaceAfter=2),
    "sub":   ParagraphStyle("s", parent=_styles["Normal"], fontSize=9.5,
                            textColor=MUTED, spaceAfter=14),
    "h":     ParagraphStyle("h", parent=_styles["Heading2"], fontSize=11, leading=14,
                            textColor=ACCENT, spaceBefore=16, spaceAfter=7),
    "body":  ParagraphStyle("b", parent=_styles["Normal"], fontSize=9.5, leading=14.5,
                            textColor=INK, spaceAfter=7),
    "cell":  ParagraphStyle("c", parent=_styles["Normal"], fontSize=8.5, leading=12,
                            textColor=INK),
    "cellh": ParagraphStyle("ch", parent=_styles["Normal"], fontSize=8, leading=11,
                            textColor=colors.white),
}


def _esc(text):
    """Escape XML special characters before handing text to Paragraph.

    reportlab parses its input as markup, so a bare & or < in an alert
    signature raises a parse error and takes the whole export down. The
    previous version passed content through unescaped.
    """
    return (str(text).replace("&", "&amp;")
                     .replace("<", "&lt;")
                     .replace(">", "&gt;"))


def _parse_sections(text):
    """Split a report into (heading, body) pairs.

    Returns a single unlabelled section when the text uses none of the known
    headings -- a plain chat answer saved as a document still needs to render.
    """
    found = [(n, text.find(n)) for n in SECTION_NAMES if text.find(n) != -1]
    if not found:
        return [(None, text.strip())]
    found.sort(key=lambda x: x[1])

    out = []
    preamble = text[:found[0][1]].strip()
    if preamble:
        out.append((None, preamble))

    for i, (name, idx) in enumerate(found):
        start = idx + len(name)
        end = found[i + 1][1] if i + 1 < len(found) else len(text)
        body = re.sub(r"^[\s:\-]+", "", text[start:end]).strip()
        if body:
            out.append((name, body))
    return out


def _extract_iocs(text):
    """Pull indicators out of the report body.

    A SOC report is expected to surface these as a table -- an analyst should
    not have to reread prose to work out which address to block.
    """
    ips = [ip for ip in dict.fromkeys(re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text))
           if all(int(o) < 256 for o in ip.split("."))]
    sigs = list(dict.fromkeys(re.findall(r"ET [A-Z]+ [^\n,.]{5,60}", text)))
    ports = list(dict.fromkeys(re.findall(r"\bport[:\s]+(\d{1,5})\b", text, re.I)))
    cves = list(dict.fromkeys(re.findall(r"CVE-\d{4}-\d{4,7}", text)))
    return ips, sigs, ports, cves


def _severity_of(text):
    """Return the stated severity, or None.

    Deliberately returns None rather than defaulting: printing a severity
    badge on a document that never assessed one would be inventing a finding.
    """
    m = re.search(r"(?:RISK LEVEL|RISK ASSESSMENT)[:\s]*\n?\s*\[?\s*"
                  r"(CRITICAL|HIGH|MEDIUM|LOW)", text, re.I)
    return m.group(1).upper() if m else None


def _case_id(title, content):
    """Stable per-document identifier, derived from content so the same
    document keeps the same ID across exports."""
    h = abs(hash(f"{title}|{content[:200]}")) % 10000
    return f"SIRA-{datetime.utcnow().year}-{h:04d}"


def _safe_filename(title):
    base = re.sub(r"[^A-Za-z0-9 _-]", "", title)[:50].strip().replace(" ", "_")
    return f"{base or 'SIRA_report'}.pdf"


def _table(rows, widths, zebra=True):
    data = [[Paragraph(_esc(c), ST["cellh"]) for c in rows[0]]]
    data += [[Paragraph(c, ST["cell"]) for c in r] for r in rows[1:]]
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if zebra:
        style.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]))
    t.setStyle(TableStyle(style))
    return t


def _furniture(canvas, doc):
    """Classification band and footer, drawn on every page."""
    canvas.saveState()
    w, h = A4

    canvas.setFillColor(BAND)
    canvas.rect(0, h - 14 * mm, w, 14 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawString(18 * mm, h - 9 * mm, "SIRA  \u00b7  SOC INVESTIGATION COPILOT")
    canvas.drawRightString(w - 18 * mm, h - 9 * mm, "CONFIDENTIAL \u2014 INTERNAL USE ONLY")

    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm,
                      "Generated automatically by SIRA. Verify findings before acting.")
    canvas.drawRightString(w - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _build_pdf(title, content, meta_lines=None, source_query="", analyst=None,
               model=None, steps=None, mitre=None):
    """Build a structured incident report.

    Sections, indicators and severity are derived from the report text itself,
    so this works on anything SIRA or Hermes produces without extra data.
    Optional arguments (steps, mitre, analyst, model) add sections when the
    caller has them and are omitted entirely when it doesn't -- the report
    never shows a heading it has no real content for.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=26 * mm, bottomMargin=20 * mm,
        leftMargin=18 * mm, rightMargin=18 * mm,
        title=title, author="SIRA",
    )
    W = A4[0] - 36 * mm

    sections = _parse_sections(content)
    ips, sigs, ports, cves = _extract_iocs(content)
    severity = _severity_of(content)
    story = []

    # ── heading, with a severity chip only when one was actually assessed ──
    if severity:
        chip = Table(
            [[Paragraph(f'<font color="white"><b>{severity} SEVERITY</b></font>', ST["cellh"])]],
            colWidths=[34 * mm])
        chip.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SEVERITY_COLOURS[severity]),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        head = Table([[Paragraph(_esc(title), ST["title"]), chip]],
                     colWidths=[W - 36 * mm, 36 * mm])
        head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(head)
    else:
        story.append(Paragraph(_esc(title), ST["title"]))

    story.append(Paragraph("Automated investigation report generated by SIRA", ST["sub"]))

    # ── metadata ──
    story.append(_table(
        [["CASE ID", "GENERATED", "ANALYST", "MODEL"],
         [_case_id(title, content),
          datetime.utcnow().strftime("%d %B %Y, %H:%M UTC"),
          _esc(analyst or "\u2014"),
          _esc(model or "\u2014")]],
        [W * 0.22, W * 0.32, W * 0.23, W * 0.23], zebra=False))

    if source_query:
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            f'<font color="#5B6572" size="8.5">Originating query: '
            f'<i>{_esc(source_query)}</i></font>', ST["body"]))

    for line in (meta_lines or []):
        story.append(Paragraph(f'<font color="#5B6572" size="8.5">{_esc(line)}</font>',
                               ST["body"]))

    # ── indicators of compromise ──
    if ips or sigs or ports or cves:
        story.append(Paragraph("Indicators of Compromise", ST["h"]))
        rows = [["TYPE", "INDICATOR", "CONTEXT"]]
        rows += [["IP address", f'<font face="Courier">{ip}</font>',
                  "Observed in alert traffic"] for ip in ips[:8]]
        rows += [["Signature", _esc(s), "Suricata detection"] for s in sigs[:5]]
        rows += [["Port", f'<font face="Courier">{p}</font>',
                  "Targeted service port"] for p in ports[:5]]
        rows += [["CVE", f'<font face="Courier">{c}</font>',
                  "Correlated vulnerability"] for c in cves[:5]]
        story.append(_table(rows, [W * 0.18, W * 0.37, W * 0.45]))

    # ── MITRE mapping, only when the caller supplied real mappings ──
    if mitre:
        story.append(Paragraph("MITRE ATT&amp;CK Mapping", ST["h"]))
        rows = [["TACTIC", "TECHNIQUE", "ID"]]
        rows += [[_esc(m.get("tactic", "\u2014")),
                  _esc(m.get("technique", "\u2014")),
                  _esc(m.get("id", "\u2014"))] for m in mitre[:10]]
        story.append(_table(rows, [W * 0.28, W * 0.52, W * 0.20]))

    # ── narrative sections ──
    for name, body in sections:
        if name in ACTION_SECTIONS:
            continue  # rendered below as a prioritised table
        story.append(Paragraph(_esc(name.title()) if name else "Overview", ST["h"]))
        for para in body.split("\n\n"):
            story.append(Paragraph(_esc(para).replace("\n", "<br/>"), ST["body"]))

    # ── investigation trail ──
    if steps:
        story.append(Paragraph("Investigation Trail", ST["h"]))
        story.append(Paragraph(
            "Each step the agent executed, in order. Included so the conclusion "
            "above can be verified rather than taken on trust.", ST["body"]))
        rows = [["#", "TOOL", "INPUT", "OUTCOME"]]
        for s in steps[:15]:
            result = str(s.get("result", ""))
            rows.append([
                str(s.get("step", "")),
                f'<font face="Courier">{_esc(s.get("tool", ""))}</font>',
                _esc(s.get("input") or "\u2014"),
                _esc(result[:180] + ("\u2026" if len(result) > 180 else "")),
            ])
        story.append(_table(rows, [W * 0.06, W * 0.24, W * 0.20, W * 0.50]))

    # ── recommended actions, as a prioritised table ──
    actions = next((b for n, b in sections if n in ACTION_SECTIONS), None)
    if actions:
        story.append(Paragraph("Recommended Actions", ST["h"]))
        items = [l.strip() for l in actions.split("\n") if re.match(r"^\d+\.", l.strip())]
        if not items:
            items = [l.strip() for l in actions.split("\n") if l.strip()]
        labels = ["IMMEDIATE", "SHORT TERM", "FOLLOW UP", "FOLLOW UP", "FOLLOW UP"]
        rows = [["PRIORITY", "ACTION"]]
        for i, item in enumerate(items[:5]):
            rows.append([labels[min(i, 4)], _esc(re.sub(r"^\d+\.\s*", "", item))])
        story.append(_table(rows, [W * 0.22, W * 0.78]))

    doc.build(story, onFirstPage=_furniture, onLaterPages=_furniture)
    buf.seek(0)
    return buf


def _pdf_from_request(data):
    """Shared between the PDF and email routes so both produce the same report."""
    title = (data.get("title") or "Untitled Document").strip()
    content = (data.get("content") or "").strip()
    source_query = data.get("source_query", "")

    meta_lines = []
    return title, content, _build_pdf(
        title, content,
        meta_lines=meta_lines,
        source_query=source_query,
        analyst=data.get("analyst"),
        model=data.get("model"),
        steps=data.get("steps"),
        mitre=data.get("mitre"),
    )


# ==================== PDF EXPORT ====================
@documents_bp.route("/pdf", methods=["POST"])
def export_pdf():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "analyst": str (optional), "model": str (optional),
            "steps": [ {step, tool, input, result} ] (optional),
            "mitre": [ {tactic, technique, id} ] (optional) }

    Returns a downloadable incident report built from the given text. The
    optional fields add sections when present; nothing breaks without them.
    """
    data = request.get_json(force=True) or {}
    if not (data.get("content") or "").strip():
        return jsonify({"error": "content is required"}), 400

    try:
        title, _, pdf_buf = _pdf_from_request(data)
    except Exception as e:
        return jsonify({"error": f"Could not build the report: {e}"}), 500

    return send_file(pdf_buf, mimetype="application/pdf",
                     as_attachment=True, download_name=_safe_filename(title))


# ==================== EMAIL SHARE ====================
@documents_bp.route("/email", methods=["POST"])
def email_document():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "to": "recipient@example.com", "message": "optional note" }
    Sends the report as a PDF attachment via SMTP.
    """
    data = request.get_json(force=True) or {}
    to_email = (data.get("to") or "").strip()

    if not (data.get("content") or "").strip():
        return jsonify({"error": "content is required"}), 400
    if not to_email:
        return jsonify({"error": "Recipient email ('to') is required"}), 400

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_email = os.environ.get("FROM_EMAIL", smtp_user)

    if not all([smtp_host, smtp_user, smtp_pass]):
        return jsonify({"error": "Email is not configured on the server (missing SMTP env vars)"}), 500

    try:
        title, _, pdf_buf = _pdf_from_request(data)
    except Exception as e:
        return jsonify({"error": f"Could not build the report: {e}"}), 500

    note = data.get("message", "")
    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = f"SIRA \u2014 {title}"
    msg.attach(MIMEText(
        note or f"Attached: SIRA investigation report '{title}'.", "plain"))

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_buf.read())
    encoders.encode_base64(attachment)
    attachment.add_header("Content-Disposition",
                          f"attachment; filename={_safe_filename(title)}")
    msg.attach(attachment)

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to_email, msg.as_string())
    except Exception as e:
        return jsonify({"error": f"Failed to send email: {str(e)}"}), 500

    return jsonify({"message": f"Document emailed to {to_email}"})