const startButton = document.getElementById('start-button');
const status = document.getElementById('status');

startButton.addEventListener('click', () => {
  status.textContent = 'Your project is ready to build.';
});
