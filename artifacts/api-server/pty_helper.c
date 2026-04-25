#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pty.h>
#include <termios.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/select.h>
#include <signal.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>

static int master_fd = -1;
static pid_t child_pid = -1;

static void handle_resize(int rows, int cols) {
    struct winsize ws;
    ws.ws_row = (unsigned short)rows;
    ws.ws_col = (unsigned short)cols;
    ws.ws_xpixel = 0;
    ws.ws_ypixel = 0;
    if (master_fd >= 0) ioctl(master_fd, TIOCSWINSZ, &ws);
    if (child_pid > 0) kill(child_pid, SIGWINCH);
}

int main(int argc, char *argv[]) {
    struct winsize ws = {24, 220, 0, 0};
    if (argc >= 3) {
        ws.ws_row = (unsigned short)atoi(argv[1]);
        ws.ws_col = (unsigned short)atoi(argv[2]);
    }

    child_pid = forkpty(&master_fd, NULL, NULL, &ws);
    if (child_pid < 0) { perror("forkpty"); return 1; }

    if (child_pid == 0) {
        char *shell = getenv("SHELL");
        if (!shell || strlen(shell) == 0) shell = "/bin/bash";
        setenv("TERM", "xterm-256color", 1);
        setenv("COLORTERM", "truecolor", 1);
        setenv("FORCE_COLOR", "3", 1);
        char *args[] = { shell, "--login", NULL };
        execvp(shell, args);
        perror("execvp");
        return 1;
    }

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);
    flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);

    char in_buf[8192];
    int in_len = 0;
    char out_buf[8192];

    while (1) {
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(master_fd, &rfds);
        FD_SET(STDIN_FILENO, &rfds);

        struct timeval tv = {0, 20000};
        int r = select(master_fd + 1, &rfds, NULL, NULL, &tv);
        if (r < 0 && errno != EINTR) break;

        if (r > 0 && FD_ISSET(master_fd, &rfds)) {
            ssize_t n = read(master_fd, out_buf, sizeof(out_buf));
            if (n > 0) {
                ssize_t written = 0;
                while (written < n) {
                    ssize_t w = write(STDOUT_FILENO, out_buf + written, n - written);
                    if (w < 0) break;
                    written += w;
                }
                fflush(stdout);
            } else if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
                break;
            }
        }

        if (r > 0 && FD_ISSET(STDIN_FILENO, &rfds)) {
            ssize_t n = read(STDIN_FILENO, in_buf + in_len, sizeof(in_buf) - in_len - 1);
            if (n > 0) {
                in_len += (int)n;
                in_buf[in_len] = '\0';

                int i = 0;
                while (i < in_len) {
                    if ((unsigned char)in_buf[i] == 0x00 && in_len - i >= 2) {
                        char *end = memchr(in_buf + i + 1, '\n', in_len - i - 1);
                        if (end) {
                            int cmd_len = (int)(end - (in_buf + i + 1));
                            char cmd[64] = {0};
                            if (cmd_len < 60) {
                                memcpy(cmd, in_buf + i + 1, cmd_len);
                                int rr, cc;
                                if (sscanf(cmd, "RESIZE:%d:%d", &rr, &cc) == 2) {
                                    handle_resize(rr, cc);
                                }
                            }
                            int skip = (int)(end - (in_buf + i)) + 1;
                            memmove(in_buf + i, in_buf + i + skip, in_len - i - skip);
                            in_len -= skip;
                        } else {
                            break;
                        }
                    } else {
                        i++;
                    }
                }

                if (i > 0) {
                    write(master_fd, in_buf, i);
                    memmove(in_buf, in_buf + i, in_len - i);
                    in_len -= i;
                }
            } else if (n == 0) {
                break;
            }
        }

        int status;
        pid_t w = waitpid(child_pid, &status, WNOHANG);
        if (w == child_pid) {
            int code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
            char msg[128];
            snprintf(msg, sizeof(msg), "\r\n\x1b[90m[processo encerrado com codigo %d]\x1b[0m\r\n", code);
            write(STDOUT_FILENO, msg, strlen(msg));
            break;
        }
    }

    return 0;
}
