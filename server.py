import http.server
import socketserver
import urllib.request
import json
import os
import sys
from pathlib import Path

PORT = 3000
PUBLIC_DIR = Path(__file__).parent / "public"

def extract_options(raw_options):
    options = []
    if not isinstance(raw_options, list):
        return options
    for opt in raw_options:
        if isinstance(opt, list) and len(opt) > 0:
            val = str(opt[0]) if opt[0] is not None else ""
            options.append({"value": val, "label": val})
        elif isinstance(opt, (str, int, float)):
            val = str(opt)
            options.append({"value": val, "label": val})
    return options

def parse_from_load_data(form_data):
    fields = []
    try:
        questions = form_data[1][1]
        if not isinstance(questions, list):
            return fields

        form_title = ""
        try:
            form_title = form_data[1][8] or form_data[1][0] or ""
        except Exception:
            pass

        section_count = 1
        current_section = f"Section 1: {form_title}" if form_title else "Section 1"

        for q in questions:
            if not isinstance(q, list):
                continue
            label = q[1].strip() if len(q) > 1 and q[1] else ""
            question_type = q[3] if len(q) > 3 else 0
            sub_entries = q[4] if len(q) > 4 and isinstance(q[4], list) else []

            if question_type in (6, 11) or (len(sub_entries) == 0 and label):
                section_count += 1
                current_section = f"Section {section_count}: {label}" if label else f"Section {section_count}"
                continue

            if len(sub_entries) == 0:
                continue

            raw_options = sub_entries[0][1] if len(sub_entries[0]) > 1 else []

            if question_type == 0:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "text", "section": current_section})
            elif question_type == 1:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "textarea", "section": current_section})
            elif question_type == 2:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "radio", "options": extract_options(raw_options), "section": current_section})
            elif question_type == 3:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "select", "options": extract_options(raw_options), "section": current_section})
            elif question_type == 4:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "checkbox", "options": extract_options(raw_options), "section": current_section})
            elif question_type in (5, 18):
                opts = extract_options(raw_options)
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "linear", "options": opts, "section": current_section})
            elif question_type in (7, 8):
                col_opts = extract_options(raw_options)
                for idx, se in enumerate(sub_entries):
                    row_label = se[3][0] if len(se) > 3 and se[3] else f"Row {idx + 1}"
                    fields.append({
                        "name": "entry." + str(se[0]),
                        "label": f"{label} [{row_label}]",
                        "type": "radio" if question_type == 7 else "checkbox",
                        "options": col_opts,
                        "isGrid": True,
                        "section": current_section
                    })
            elif question_type == 9:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "date", "section": current_section})
            elif question_type == 10:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "time", "section": current_section})
            else:
                fields.append({"name": "entry." + str(sub_entries[0][0]), "label": label, "type": "text", "section": current_section})
    except Exception as e:
        print("Error parsing form data:", e)
    return fields

class ConfiguratorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_POST(self):
        if self.path == '/api/fetch-form':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                req_data = json.loads(body.decode('utf-8'))
                url = req_data.get('url', '').strip()
                if not url or 'docs.google.com/forms' not in url:
                    self.send_json_response({"success": False, "error": "Please provide a valid Google Form URL."}, 400)
                    return

                req = urllib.request.Request(
                    url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                with urllib.request.urlopen(req) as resp:
                    html = resp.read().decode('utf-8', errors='ignore')

                start_idx = html.find('FB_PUBLIC_LOAD_DATA_')
                if start_idx == -1:
                    self.send_json_response({"success": False, "error": "Could not find form data in page HTML."}, 400)
                    return

                arr_start = html.find('[', start_idx)
                arr_end = html.rfind(']')
                json_str = html[arr_start:arr_end + 1]
                form_data = json.loads(json_str)

                title = "Google Form"
                try:
                    title = form_data[1][8] or form_data[1][0] or "Google Form"
                except Exception:
                    pass

                fields = parse_from_load_data(form_data)
                self.send_json_response({"success": True, "title": title, "fields": fields})

            except Exception as e:
                self.send_json_response({"success": False, "error": str(e)}, 500)
        else:
            self.send_error(404)

    def send_json_response(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    print(f"🚀 Form Configurator Web Server starting at http://localhost:{PORT}")
    print("Press Ctrl+C to stop the server.")
    with socketserver.TCPServer(("", PORT), ConfiguratorHandler) as httpd:
        httpd.serve_forever()
