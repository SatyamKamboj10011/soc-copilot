import os
import io
import smtplib
from dotenv import load_dotenv

from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders

from flask import Blueprint, request, jsonify, send_file
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.enums import TA_LEFT

documents_bp = Blueprint("documents", __name__)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


def _build_pdf(title, content, meta_lines=None):
    """Returns a BytesIO buffer containing a formatted PDF."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        topMargin=0.9 * inch, bottomMargin=0.9 * inch,
        leftMargin=0.9 * inch, rightMargin=0.9 * inch,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DocTitle", parent=styles["Title"], alignment=TA_LEFT, fontSize=18, spaceAfter=12
    )
    meta_style = ParagraphStyle(
        "DocMeta", parent=styles["Normal"], textColor="#666666", fontSize=9, spaceAfter=16
    )
    body_style = ParagraphStyle(
        "DocBody", parent=styles["Normal"], fontSize=11, leading=16, spaceAfter=10
    )

    story = [Paragraph(title, title_style)]
    if meta_lines:
        for line in meta_lines:
            story.append(Paragraph(line, meta_style))
    story.append(Spacer(1, 6))

    for para in content.split("\n\n"):
        safe = para.replace("\n", "<br/>")
        story.append(Paragraph(safe, body_style))

    doc.build(story)
    buf.seek(0)
    return buf


# ==================== PDF EXPORT ====================
@documents_bp.route("/pdf", methods=["POST"])
def export_pdf():
    """
    Body: { "title": str, "content": str, "source_query": str (optional) }
    Returns a downloadable PDF built from the given text — no database involved.
    """
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "Untitled Document").strip()
    content = (data.get("content") or "").strip()
    source_query = data.get("source_query", "")

    if not content:
        return jsonify({"error": "content is required"}), 400

    meta_lines = []
    if source_query:
        meta_lines.append(f"Query: {source_query}")

    pdf_buf = _build_pdf(title, content, meta_lines)
    filename = f"{title[:50].replace(' ', '_')}.pdf"
    return send_file(pdf_buf, mimetype="application/pdf", as_attachment=True, download_name=filename)


# ==================== EMAIL SHARE ====================
@documents_bp.route("/email", methods=["POST"])
def email_document():
    """
    Body: { "title": str, "content": str, "source_query": str (optional),
            "to": "recipient@example.com", "message": "optional note" }
    Sends the document as a PDF attachment via SMTP.
    """
    data = request.get_json(force=True) or {}
    title = (data.get("title") or "Untitled Document").strip()
    content = (data.get("content") or "").strip()
    source_query = data.get("source_query", "")
    to_email = (data.get("to") or "").strip()
    note = data.get("message", "")

    if not content:
        return jsonify({"error": "content is required"}), 400
    if not to_email:
        return jsonify({"error": "Recipient email ('to') is required"}), 400

    meta_lines = []
    if source_query:
        meta_lines.append(f"Query: {source_query}")
    pdf_buf = _build_pdf(title, content, meta_lines)

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_email = os.environ.get("FROM_EMAIL", smtp_user)

    if not all([smtp_host, smtp_user, smtp_pass]):
        return jsonify({"error": "Email is not configured on the server (missing SMTP env vars)"}), 500

    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = f"SIRA — {title}"
    body = note or f"Attached: Hermes investigation document '{title}'."
    msg.attach(MIMEText(body, "plain"))

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_buf.read())
    encoders.encode_base64(attachment)
    filename = f"{title[:50].replace(' ', '_')}.pdf"
    attachment.add_header("Content-Disposition", f"attachment; filename={filename}")
    msg.attach(attachment)

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to_email, msg.as_string())
    except Exception as e:
        return jsonify({"error": f"Failed to send email: {str(e)}"}), 500

    return jsonify({"message": f"Document emailed to {to_email}"})