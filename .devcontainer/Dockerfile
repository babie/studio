FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG OLD_USER=vscode
ARG NEW_USER=dev

# vscode ユーザを dev にリネーム (uid/gid は 1000 のまま)
RUN usermod -l ${NEW_USER} ${OLD_USER} \
 && usermod -d /home/${NEW_USER} -m ${NEW_USER} \
 && groupmod -n ${NEW_USER} ${OLD_USER} \
 && if [ -f /etc/sudoers.d/${OLD_USER} ]; then \
      sed -i "s/${OLD_USER}/${NEW_USER}/g" /etc/sudoers.d/${OLD_USER} \
      && mv /etc/sudoers.d/${OLD_USER} /etc/sudoers.d/${NEW_USER}; \
    fi
