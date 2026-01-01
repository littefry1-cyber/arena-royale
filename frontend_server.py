"""
Arena Royale Frontend Server
Serves static files on localhost:8080
"""

import http.server
import socketserver
import os

PORT = 5000
HOST = "0.0.0.0"  # Listen on all network interfaces

# Change to the script's directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with cleaner logging"""

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {args[0]}")

def main():
    import socket
    # Get local IP for network access
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "unknown"

    print(f"""
============================================
   Arena Royale Frontend Server
============================================

Local:    http://localhost:{PORT}
Network:  http://{local_ip}:{PORT}

Share the Network URL with others on your network!

Press Ctrl+C to stop
--------------------------------------------
""")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), QuietHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
