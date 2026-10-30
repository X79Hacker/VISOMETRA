# Publishing VISOMETRA on GitHub

Create a new empty GitHub repository named `VISOMETRA`. Extract this ZIP, then open PowerShell inside the extracted `VISOMETRA` folder.

```powershell
git lfs install
git lfs track "*.onnx"
git init
git add -A
git commit -m "Initial VISOMETRA release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/VISOMETRA.git
git push -u origin main
```

Install Git LFS first (`git lfs version` should work). Check GitHub's LFS quotas. If pushing fails, inspect the largest files and verify that LFS tracked them *before* the first commit. Do not run `echo "# VISOMETRA" >> README.md`: the README is already complete.
