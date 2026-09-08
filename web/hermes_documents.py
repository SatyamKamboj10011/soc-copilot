import os
import io
import re
import smtplib
from datetime import datetime
from dotenv import load_dotenv

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from flask import Blueprint, request, jsonify, send_file
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, HRFlowable
)
from reportlab.lib.enums import TA_LEFT

documents_bp = Blueprint("documents", __name__)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# =============================================================================
# HERMES // CYBER INTELLIGENCE REPORT
# Complete presentation redesign. API routes, payloads, IOC extraction,
# MITRE data, investigation steps, PDF export and email behaviour are unchanged.
# =============================================================================

# --- Palette: dark SOC / threat-intelligence command center ------------------
NAVY = colors.HexColor("#07111F")
NAVY_2 = colors.HexColor("#0B1727")
NAVY_3 = colors.HexColor("#101F32")
CYAN = colors.HexColor("#35D6FF")
CYAN_DARK = colors.HexColor("#0A9CC7")
ICE = colors.HexColor("#EAF6FF")
WHITE = colors.HexColor("#F7FAFC")
TEXT = colors.HexColor("#DCE7F2")
MUTED = colors.HexColor("#8193A7")
DIM = colors.HexColor("#526579")
LINE = colors.HexColor("#203247")
LINE_SOFT = colors.HexColor("#17283A")
RED = colors.HexColor("#FF4D5E")
ORANGE = colors.HexColor("#FF9F43")
AMBER = colors.HexColor("#FFC857")
GREEN = colors.HexColor("#32D583")
PURPLE = colors.HexColor("#9B7BFF")
BLACK = colors.HexColor("#050B13")

SEVERITY_COLOURS = {
    "CRITICAL": RED,
    "HIGH": ORANGE,
    "MEDIUM": AMBER,
    "LOW": GREEN,
}

SECTION_NAMES = [
    "SUMMARY", "OVERVIEW", "THREAT DETAILS", "TOP THREATS", "PATTERNS DETECTED",
    "WHAT THIS MEANS", "ENDPOINT SECURITY", "RISK LEVEL", "RISK ASSESSMENT",
    "CVE IMPACT", "SITUATION", "RECOMMENDED ACTIONS", "PRIORITY ACTIONS",
    "IMMEDIATE ACTIONS",
]
ACTION_SECTIONS = {"RECOMMENDED ACTIONS", "PRIORITY ACTIONS", "IMMEDIATE ACTIONS"}

_styles = getSampleStyleSheet()
ST = {
    "cover_kicker": ParagraphStyle(
        "cover_kicker", parent=_styles["Normal"], fontName="Helvetica-Bold",
        fontSize=7.2, leading=9, textColor=CYAN, spaceAfter=4
    ),
    "title": ParagraphStyle(
        "cyber_title", parent=_styles["Title"], fontName="Helvetica-Bold",
        fontSize=25, leading=27, textColor=WHITE, spaceAfter=6
    ),
    "subtitle": ParagraphStyle(
        "cyber_subtitle", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=9.3, leading=13, textColor=MUTED
    ),
    "section": ParagraphStyle(
        "section", parent=_styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=10, leading=12, textColor=WHITE, spaceBefore=7, spaceAfter=6
    ),
    "section_num": ParagraphStyle(
        "section_num", parent=_styles["Normal"], fontName="Courier-Bold",
        fontSize=7, leading=9, textColor=CYAN
    ),
    "body": ParagraphStyle(
        "body", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=8.6, leading=12.3, textColor=TEXT, spaceAfter=5
    ),
    "body_small": ParagraphStyle(
        "body_small", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=7.5, leading=10.3, textColor=TEXT
    ),
    "muted": ParagraphStyle(
        "muted", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=7.1, leading=9.4, textColor=MUTED
    ),
    "label": ParagraphStyle(
        "label", parent=_styles["Normal"], fontName="Helvetica-Bold",
        fontSize=6.2, leading=7.5, textColor=MUTED, tracking=0.5
    ),
    "metric": ParagraphStyle(
        "metric", parent=_styles["Normal"], fontName="Helvetica-Bold",
        fontSize=15, leading=16, textColor=WHITE
    ),
    "metric_small": ParagraphStyle(
        "metric_small", parent=_styles["Normal"], fontName="Helvetica-Bold",
        fontSize=6.2, leading=7.2, textColor=MUTED
    ),
    "table_head": ParagraphStyle(
        "table_head", parent=_styles["Normal"], fontName="Helvetica-Bold",
        fontSize=6.3, leading=7.5, textColor=ICE
    ),
    "table": ParagraphStyle(
        "table", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=7.1, leading=9.1, textColor=TEXT
    ),
    "mono": ParagraphStyle(
        "mono", parent=_styles["Normal"], fontName="Courier",
        fontSize=6.9, leading=8.7, textColor=ICE
    ),
    "action": ParagraphStyle(
        "action", parent=_styles["Normal"], fontName="Helvetica",
        fontSize=7.8, leading=10.4, textColor=TEXT
    ),
}

def _esc(text):
    return (str(text).replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;"))

def _clean_text(text):
    """Strip characters that can become black boxes with limited PDF fonts."""
    text = str(text or "")
    replacements = {
        "\u2022": "-", "\u2023": "-", "\u25cf": "o", "\u25cb": "o",
        "\u25a0": "-", "\u25a1": "-", "\u2013": "-", "\u2014": "-",
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2192": "->", "\u2190": "<-", "\u2194": "<->",
        "\u2026": "...", "\u00a0": " ", "\u2713": "OK",
        "\u2717": "X", "\u26a0": "!", "\u00b7": "|",
    }
    for a, b in replacements.items():
        text = text.replace(a, b)
    return text

def _parse_sections(text):
    text = _clean_text(text)
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
    text = _clean_text(text)
    ips = [ip for ip in dict.fromkeys(
        re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text)
    ) if all(int(o) < 256 for o in ip.split("."))]
    sigs = list(dict.fromkeys(re.findall(r"ET [A-Z]+ [^\n,.]{5,60}", text)))
    ports = list(dict.fromkeys(re.findall(r"\bport[:\s]+(\d{1,5})\b", text, re.I)))
    cves = list(dict.fromkeys(re.findall(r"CVE-\d{4}-\d{4,7}", text)))
    return ips, sigs, ports, cves

def _severity_of(text):
    m = re.search(
        r"(?:RISK LEVEL|RISK ASSESSMENT)[:\s]*\n?\s*\[?\s*"
        r"(CRITICAL|HIGH|MEDIUM|LOW)", _clean_text(text), re.I
    )
    return m.group(1).upper() if m else None

def _case_id(title, content):
    h = abs(hash(f"{title}|{content[:200]}")) % 10000
    return f"SIRA-{datetime.utcnow().year}-{h:04d}"

def _safe_filename(title):
    base = re.sub(r"[^A-Za-z0-9 _-]", "", title)[:50].strip().replace(" ", "_")
    return f"{base or 'SIRA_report'}.pdf"

def _panel(flowables, width, background=NAVY_2, border=LINE, accent=None,
           left=10, right=10, top=9, bottom=9):
    t = Table([[flowables]], colWidths=[width])
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.65, border),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), left),
        ("RIGHTPADDING", (0, 0), (-1, -1), right),
        ("TOPPADDING", (0, 0), (-1, -1), top),
        ("BOTTOMPADDING", (0, 0), (-1, -1), bottom),
    ]
    if accent:
        style.append(("LINEBEFORE", (0, 0), (0, 0), 2.5, accent))
    t.setStyle(TableStyle(style))
    return t

def _table(rows, widths, zebra=True):
    data = [[Paragraph(_esc(c), ST["table_head"]) for c in rows[0]]]
    for r in rows[1:]:
        data.append([
            Paragraph(str(c), ST["mono"] if ("Courier" in str(c)) else ST["table"])
            for c in r
        ])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY_3),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.65, LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 1.1, CYAN_DARK),
    ]
    if zebra and len(rows) > 2:
        style.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [NAVY_2, NAVY]))
    t.setStyle(TableStyle(style))
    return t

def _section_header(number, title):
    title = _clean_text(title).upper()
    tbl = Table([[
        Paragraph(f"{number:02d}", ST["section_num"]),
        Paragraph(_esc(title), ST["section"])
    ]], colWidths=[12 * mm, None])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.7, LINE),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl

def _severity_badge(severity, width=30 * mm):
    label = severity or "ASSESSMENT"
    col = SEVERITY_COLOURS.get(severity, CYAN)
    t = Table([[
        Paragraph(
            f'<font size="6"><b>RISK CLASS</b></font><br/>'
            f'<font size="13"><b>{_esc(label)}</b></font>',
            ParagraphStyle("sev_badge", parent=ST["table"], textColor=WHITE, leading=15)
        )
    ]], colWidths=[width], rowHeights=[22 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), col),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t

def _metric_strip(metrics, width):
    cells = []
    for label, value, accent in metrics:
        cells.append([
            Paragraph(_esc(str(value)), ST["metric"]),
            Paragraph(_esc(label), ST["metric_small"]),
        ])
    t = Table([cells[0]], colWidths=[width / len(cells)] * len(cells))
    # Each cell is itself a mini stack.
    t = Table([[
        [Paragraph(_esc(str(v)), ST["metric"]),
         Paragraph(_esc(label), ST["metric_small"])]
        for label, v, _ in metrics
    ]], colWidths=[width / len(metrics)] * len(metrics))
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
    for i, (_, _, accent) in enumerate(metrics):
        style.append(("LINEBEFORE", (i, 0), (i, 0), 2, accent))
    t.setStyle(TableStyle(style))
    return t

def _draw_gauge(canvas, x, y, radius, pct, color):
    canvas.saveState()
    canvas.setLineWidth(5)
    canvas.setStrokeColor(LINE)
    canvas.arc(x - radius, y - radius, x + radius, y + radius, 210, 300)
    canvas.setStrokeColor(color)
    canvas.arc(x - radius, y - radius, x + radius, y + radius, 210, max(1, 300 * pct))
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 15)
    canvas.drawCentredString(x, y - 4, f"{int(pct * 100)}%")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6)
    canvas.drawCentredString(x, y - 13, "RISK SIGNAL")
    canvas.restoreState()

def _furniture(canvas, doc):
    """Cybersecurity report shell: dense, visual, no decorative black-space blocks."""
    canvas.saveState()
    w, h = A4

    # Full dark page.
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, stroke=0, fill=1)

    # Technical grid: subtle and deliberately sparse.
    canvas.setStrokeColor(colors.HexColor("#0E1D2D"))
    canvas.setLineWidth(0.25)
    for x in range(0, int(w), 18):
        canvas.line(x * mm, 12 * mm, x * mm, h - 15 * mm)
    for y in range(18, int(h / mm), 18):
        canvas.line(12 * mm, y * mm, w - 12 * mm, y * mm)

    # Header command bar.
    canvas.setFillColor(NAVY_2)
    canvas.rect(0, h - 14 * mm, w, 14 * mm, stroke=0, fill=1)
    canvas.setFillColor(CYAN)
    canvas.rect(0, h - 14 * mm, w, 1.1 * mm, stroke=0, fill=1)

    canvas.setFillColor(CYAN)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(14 * mm, h - 8.4 * mm, "HERMES")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6)
    canvas.drawString(31 * mm, h - 8.4 * mm, "SECURITY INTELLIGENCE // AUTOMATED ANALYSIS")

    # Right-side report classification.
    canvas.setFillColor(GREEN)
    canvas.circle(w - 46 * mm, h - 8 * mm, 1.1 * mm, stroke=0, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Bold", 5.8)
    canvas.drawString(w - 42.5 * mm, h - 9.5 * mm, "ANALYSIS READY")
    canvas.setFillColor(DIM)
    canvas.drawRightString(w - 14 * mm, h - 9.5 * mm, "CONFIDENTIAL")

    # Footer.
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(14 * mm, 11 * mm, w - 14 * mm, 11 * mm)
    canvas.setFillColor(DIM)
    canvas.setFont("Helvetica", 5.8)
    canvas.drawString(14 * mm, 6.7 * mm, "HERMES // automated security intelligence // validate findings before response")
    canvas.setFillColor(MUTED)
    canvas.setFont("Courier-Bold", 6)
    canvas.drawRightString(w - 14 * mm, 6.7 * mm, f"{doc.page:02d}")
    canvas.restoreState()

def _build_pdf(title, content, meta_lines=None, source_query="", analyst=None,
               model=None, steps=None, mitre=None):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=19 * mm, bottomMargin=17 * mm,
        leftMargin=14 * mm, rightMargin=14 * mm,
        title=title, author="Hermes",
        allowSplitting=1,
    )
    W = A4[0] - 28 * mm
    sections = _parse_sections(content)
    ips, sigs, ports, cves = _extract_iocs(content)
    severity = _severity_of(content)
    sev_color = SEVERITY_COLOURS.get(severity, CYAN)
    sev_label = severity or "ASSESSMENT"
    case_id = _case_id(title, content)
    story = []

    # -------------------------------------------------------------------------
    # 01 // COVER / COMMAND SUMMARY
    # -------------------------------------------------------------------------
    left = [
        Paragraph("THREAT INTELLIGENCE / SECURITY INVESTIGATION", ST["cover_kicker"]),
        Paragraph(_esc(title), ST["title"]),
        Paragraph(
            "Automated investigation dossier generated by Hermes. "
            "Evidence, indicators, mapped techniques and response guidance are "
            "assembled below for analyst validation.",
            ST["subtitle"]
        ),
    ]

    badge = _severity_badge(sev_label)
    hero = Table([[left, badge]], colWidths=[W - 34 * mm, 30 * mm])
    hero.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("LINEBEFORE", (0, 0), (0, 0), 3, CYAN),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(hero)
    story.append(Spacer(1, 5))

    # Compact case telemetry, replacing the old large metadata block.
    meta = [
        ["CASE", "GENERATED", "ANALYST", "MODEL"],
        [
            case_id,
            datetime.utcnow().strftime("%d %b %Y %H:%M UTC"),
            _clean_text(analyst or "Hermes AI"),
            _clean_text(model or "Not specified"),
        ],
    ]
    data = [[Paragraph(_esc(x), ST["label"]) for x in meta[0]],
            [Paragraph(_esc(x), ST["table"]) for x in meta[1]]]
    mt = Table(data, colWidths=[W / 4] * 4)
    mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_3),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 4),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 5),
    ]))
    story.append(mt)

    if source_query:
        story.append(Spacer(1, 4))
        story.append(
            Paragraph(
                f'<font color="#35D6FF"><b>SOURCE QUERY</b></font>  '
                f'<font color="#8193A7">{_esc(_clean_text(source_query))}</font>',
                ST["muted"]
            )
        )
    for line in (meta_lines or []):
        story.append(Paragraph(_esc(_clean_text(line)), ST["muted"]))

    # -------------------------------------------------------------------------
    # 02 // SIGNAL COUNTS
    # -------------------------------------------------------------------------
    metrics = [
        ("INDICATORS", len(ips) + len(sigs) + len(ports) + len(cves), CYAN),
        ("MITRE TECHNIQUES", len(mitre or []), PURPLE),
        ("INVESTIGATION STEPS", len(steps or []), GREEN),
        ("CVE SIGNALS", len(cves), RED),
    ]
    story.append(Spacer(1, 5))
    story.append(_metric_strip(metrics, W))

    # -------------------------------------------------------------------------
    # 03 // EXECUTIVE BRIEF + RISK VISUAL
    # -------------------------------------------------------------------------
    summary_body = next(
        (b for n, b in sections
         if n in {"SUMMARY", "OVERVIEW", "WHAT THIS MEANS", "SITUATION"}),
        None
    )
    if summary_body:
        story.append(_section_header(1, "Executive Brief"))
        paragraphs = [
            Paragraph(_esc(_clean_text(p)).replace("\n", "<br/>"), ST["body"])
            for p in summary_body.split("\n\n")[:4]
            if p.strip()
        ]
        risk_note = {
            "CRITICAL": "Immediate containment and escalation recommended.",
            "HIGH": "Prompt investigation and remediation recommended.",
            "MEDIUM": "Targeted validation and remediation recommended.",
            "LOW": "Continue monitoring and validate the signal.",
        }.get(severity, "Validate the evidence before response.")
        right = [
            Paragraph("ANALYST SIGNAL", ST["label"]),
            Spacer(1, 4),
            Paragraph(
                f'<font color="#{sev_color.hexval()[2:]}"><b>{_esc(sev_label)}</b></font>',
                ST["metric"]
            ),
            Spacer(1, 2),
            Paragraph(_esc(risk_note), ST["muted"]),
            Spacer(1, 5),
            Paragraph(
                f'<font color="#35D6FF"><b>{len(ips) + len(sigs) + len(ports) + len(cves)}</b></font> '
                f'correlated indicators',
                ST["muted"]
            ),
        ]
        brief = Table([[
            _panel(paragraphs, W * 0.69, background=NAVY_2, accent=CYAN,
                   left=11, right=11, top=9, bottom=7),
            _panel(right, W * 0.31, background=NAVY_3, accent=sev_color,
                   left=10, right=8, top=9, bottom=8)
        ]], colWidths=[W * 0.69, W * 0.31])
        brief.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(brief)

    # -------------------------------------------------------------------------
    # 04 // IOC INTELLIGENCE
    # -------------------------------------------------------------------------
    if ips or sigs or ports or cves:
        story.append(_section_header(2, "Indicator Intelligence"))
        rows = [["TYPE", "INDICATOR", "SECURITY CONTEXT"]]
        rows += [
            ["IP ADDRESS", f'<font face="Courier">{_esc(ip)}</font>', "Observed in alert traffic"]
            for ip in ips[:8]
        ]
        rows += [
            ["SIGNATURE", _esc(s), "Detection signature / network telemetry"]
            for s in sigs[:5]
        ]
        rows += [
            ["PORT", f'<font face="Courier">{_esc(p)}</font>', "Targeted service port"]
            for p in ports[:5]
        ]
        rows += [
            ["CVE", f'<font face="Courier">{_esc(c)}</font>', "Correlated vulnerability signal"]
            for c in cves[:5]
        ]
        story.append(_table(rows, [W * .18, W * .36, W * .46]))

    # -------------------------------------------------------------------------
    # 05 // MITRE ATT&CK MATRIX-LIKE VIEW
    # -------------------------------------------------------------------------
    if mitre:
        story.append(_section_header(3, "MITRE ATT&CK Mapping"))
        rows = [["TACTIC", "TECHNIQUE", "ATT&CK ID"]]
        for m in mitre[:12]:
            rows.append([
                _esc(_clean_text(m.get("tactic", "Unknown"))),
                _esc(_clean_text(m.get("technique", "Unknown"))),
                f'<font face="Courier"><b>{_esc(_clean_text(m.get("id", "—")))}</b></font>',
            ])
        story.append(_table(rows, [W * .27, W * .53, W * .20]))

    # -------------------------------------------------------------------------
    # 06 // DETAILED INTELLIGENCE - compact two-column content where possible
    # -------------------------------------------------------------------------
    detail_num = 4
    skip_names = {
        "SUMMARY", "OVERVIEW", "WHAT THIS MEANS", "SITUATION",
        "RECOMMENDED ACTIONS", "PRIORITY ACTIONS", "IMMEDIATE ACTIONS"
    }
    for name, body in sections:
        if name in skip_names:
            continue
        story.append(_section_header(detail_num, name or "Detailed Findings"))
        detail_num += 1
        paras = []
        for para in body.split("\n\n"):
            clean = _clean_text(para).strip()
            if clean:
                paras.append(
                    Paragraph(_esc(clean).replace("\n", "<br/>"), ST["body"])
                )
        if paras:
            story.append(_panel(paras, W, background=NAVY_2, accent=CYAN_DARK,
                                left=10, right=10, top=8, bottom=5))

    # -------------------------------------------------------------------------
    # 07 // INVESTIGATION TRAIL - visual numbered timeline
    # -------------------------------------------------------------------------
    if steps:
        story.append(_section_header(detail_num, "Investigation Trail"))
        story.append(Paragraph(
            "Ordered evidence trail showing the checks performed by the agent.",
            ST["muted"]
        ))
        trail_rows = []
        for i, s in enumerate(steps[:15], 1):
            tool = _clean_text(s.get("tool") or "Investigation step")
            inp = _clean_text(s.get("input") or "No input recorded")
            result = _clean_text(s.get("result") or "")
            result = result[:360] + ("..." if len(result) > 360 else "")
            trail_rows.append([
                Paragraph(f'<font color="#35D6FF"><b>{i:02d}</b></font>', ST["table"]),
                Paragraph(
                    f'<font color="#EAF6FF"><b>{_esc(tool)}</b></font><br/>'
                    f'<font color="#526579">{_esc(inp)}</font>',
                    ST["table"]
                ),
                Paragraph(_esc(result), ST["table"]),
            ])
        trail = Table(trail_rows, colWidths=[W * .09, W * .28, W * .63])
        trail.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
            ("BOX", (0, 0), (-1, -1), 0.65, LINE),
            ("LINEBEFORE", (0, 0), (0, -1), 1.5, CYAN_DARK),
            ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE_SOFT),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(trail)
        detail_num += 1

    # -------------------------------------------------------------------------
    # 08 // RESPONSE PLAN - priority lanes
    # -------------------------------------------------------------------------
    actions = next((b for n, b in sections if n in ACTION_SECTIONS), None)
    if actions:
        story.append(_section_header(detail_num, "Response Plan"))
        items = [
            l.strip() for l in _clean_text(actions).split("\n")
            if re.match(r"^\d+\.", l.strip())
        ]
        if not items:
            items = [l.strip() for l in _clean_text(actions).split("\n") if l.strip()]
        labels = ["NOW", "24 HOURS", "FOLLOW-UP", "FOLLOW-UP", "FOLLOW-UP"]
        action_rows = []
        for i, item in enumerate(items[:6]):
            action_rows.append([
                Paragraph(
                    f'<font color="#35D6FF"><b>{labels[min(i, 4)]}</b></font>',
                    ST["action"]
                ),
                Paragraph(
                    f'<b>{_esc(re.sub(r"^\d+\.\s*", "", item))}</b>',
                    ST["action"]
                )
            ])
        action_table = Table(action_rows, colWidths=[W * .20, W * .80])
        action_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY_2),
            ("BOX", (0, 0), (-1, -1), 0.7, LINE),
            ("LINEBEFORE", (0, 0), (0, -1), 2, CYAN),
            ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE_SOFT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(action_table)
        detail_num += 1

    # -------------------------------------------------------------------------
    # FINAL // ASSESSMENT
    # -------------------------------------------------------------------------
    final_text = {
        "CRITICAL": "Immediate investigation and containment recommended.",
        "HIGH": "Prompt investigation and remediation recommended.",
        "MEDIUM": "Further validation and targeted remediation recommended.",
        "LOW": "Continue monitoring and validate findings.",
    }.get(severity, "Review findings and validate before taking action.")

    story.append(Spacer(1, 6))
    final = Table([[
        [
            Paragraph("FINAL HERMES ASSESSMENT", ST["label"]),
            Spacer(1, 2),
            Paragraph(
                f'<font color="#{sev_color.hexval()[2:]}"><b>{_esc(sev_label)}</b></font>',
                ST["metric"]
            ),
            Paragraph(_esc(final_text), ST["muted"]),
        ]
    ]], colWidths=[W])
    final.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY_3),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("LINEBEFORE", (0, 0), (0, 0), 3, sev_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(final)

    doc.build(story, onFirstPage=_furniture, onLaterPages=_furniture)
    buf.seek(0)
    return buf

def _pdf_from_request(data):
    """Shared between PDF and email routes so both produce the same report."""
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

@documents_bp.route("/pdf", methods=["POST"])
def export_pdf():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "analyst": str (optional), "model": str (optional),
            "steps": [ {step, tool, input, result} ] (optional),
            "mitre": [ {tactic, technique, id} ] (optional) }
    """
    data = request.get_json(force=True) or {}
    if not (data.get("content") or "").strip():
        return jsonify({"error": "content is required"}), 400
    try:
        title, _, pdf_buf = _pdf_from_request(data)
    except Exception as e:
        return jsonify({"error": f"Could not build the report: {e}"}), 500
    return send_file(
        pdf_buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=_safe_filename(title),
    )

@documents_bp.route("/email", methods=["POST"])
def email_document():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "to": "recipient@example.com", "message": "optional note" }
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
    from_email = os.environ.get("SMTP_FROM", smtp_user)

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
    msg["Subject"] = f"SIRA — {title}"
    msg.attach(MIMEText(
        note or f"Attached: SIRA investigation report '{title}'.", "plain"
    ))

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_buf.read())
    encoders.encode_base64(attachment)
    attachment.add_header(
        "Content-Disposition",
        f"attachment; filename={_safe_filename(title)}"
    )
    msg.attach(attachment)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, to_email, msg.as_string())
        server.quit()
    except Exception as e:
        return jsonify({"error": f"Failed to send email: {e}"}), 500

    return jsonify({"message": f"Document emailed to {to_email}"})
