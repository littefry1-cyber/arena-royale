"""
Arena Royale Frontend Server
Serves static files on localhost:8080
"""

import http.server
import socketserver
import os

PORT = 8080
HOST = "localhost"

# Change to the script's directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with cleaner logging"""

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {args[0]}")

def main():
    print(f"""
============================================
   Arena Royale Frontend Server
============================================

Serving on: http://{HOST}:{PORT}
Open this URL in your browser to play!

Press Ctrl+C to stop
--------------------------------------------
""")

    with socketserver.TCPServer((HOST, PORT), QuietHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
