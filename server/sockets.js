export function setupSocket (io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });

    socket.on('chat message', (msg) => {
      console.log(`Message received: ${msg}`);
      socket.broadcast.emit('chat message', msg);
    });
  });
}
