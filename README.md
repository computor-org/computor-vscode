# Computor VS Code Extension

VS Code extension for Computor teaching software.

## Getting Started with Computor

Computor is a teaching software extension for Visual Studio Code. Follow these steps to set up and start using Computor.

### Initial Setup

#### Step 1: Configure Git

1. Open the Command Palette by pressing `F1` (or `Ctrl+Shift+P` / `Cmd+Shift+P`)

2. Search for and execute the command:
   ```
   Computor: Configure Git
   ```

3. You will be prompted to provide the following information:
   - **Name**: Enter your name in the format `{given_name} {family_name}` (e.g., "Max Mustermann")
   - **Email**: Enter your TU Graz email address

#### Step 2: VPN Connection Check and GitLab Token Generation

Before you begin, ensure you are connected to the TU Graz VPN.

To verify your VPN connection:
- Open your web browser and navigate to: https://computor.itp.tugraz.at
- If the website is available, you are connected to the VPN
- If not, please connect to the TU Graz VPN before proceeding

**Create your GitLab Personal Access Token:**

Go to [GitLab Personal Access Tokens](https://gitlab.tugraz.at/-/user_settings/personal_access_tokens) and click `Add new Token`.

For that new token:
- name it `computor`
- set the expiration date to a year from now
- tick
  - `api`
  - `read_repository`
  - `write_repository`

Then copy your generated token and save it temporarily - you will need it in Step 4.

#### Step 3: Configure Backend URL

1. Open the Command Palette by pressing `F1` (or `Ctrl+Shift+P` / `Cmd+Shift+P`)

2. Search for and execute the command:
   ```
   Computor: Change Backend URL
   ```

3. Enter the following URL:
   ```
   https://computor.itp.tugraz.at/api
   ```

#### Step 4: Sign Up and Set Password

**IMPORTANT:** Once you set your password, it cannot be changed using this command again. If you forget your password or need to reset it, you must contact the course staff for a manual password reset. Only after staff resets your password can you use the `Computor: Sign Up (Set Initial Password)` command to set a new one.

1. Open the Command Palette by pressing `F1` (or `Ctrl+Shift+P` / `Cmd+Shift+P`)

2. Search for and execute the command:
   ```
   Computor: Sign Up (Set Initial Password)
   ```

3. You will be prompted to provide the following information:
   - **GitLab URL**: Enter your GitLab instance URL
   - **Personal Access Token**: Enter your GitLab personal access token (from Step 2)

4. The extension will validate your personal access token to ensure it's authentic

5. Once validated, you will be asked to set a new password:
   - Enter your desired password
   - Confirm by entering the same password again

#### Step 5: Login

After successfully setting up your password, you will be automatically prompted to log in.

Provide the following credentials:
- **Email**: Enter your student email address
- **Password**: Enter the password you just created

You can now access Computor and begin using the teaching software features.

---

## Token Management

- Use the command "Manage GitLab Tokens" to set or remove a GitLab Personal Access Token per origin (e.g., `https://gitlab.provider.com`). Tokens are stored securely in VS Code secret storage and used for cloning student repositories in Tutor workflows.
