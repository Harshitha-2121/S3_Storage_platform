import net from "node:net";

const TARGET_HOST = process.env.REMOTE_BACKEND_HOST || "10.70.70.47";
const PORTS = [3210, 3211, 3220, 9000, 9001, 6791];

for (const port of PORTS) {
  const server = net.createServer((clientSocket) => {
    const remoteSocket = net.connect(port, TARGET_HOST);

    clientSocket.pipe(remoteSocket);
    remoteSocket.pipe(clientSocket);

    clientSocket.on("error", () => remoteSocket.destroy());
    remoteSocket.on("error", () => clientSocket.destroy());
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[proxy] 127.0.0.1:${port} -> ${TARGET_HOST}:${port}`);
  });

  server.on("error", (err) => {
    console.error(`[proxy] Error on port ${port}:`, err.message);
  });
}
