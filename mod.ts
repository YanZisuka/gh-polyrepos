#!/usr/bin/env zx

// deno-lint-ignore-file ban-ts-comment
import { $ } from 'zx'

import { readdir, stat } from 'node:fs/promises'
import inquirer from 'inquirer'
import kebab from 'kebab-case'

async function getRootDir(): Promise<string> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'rootDir',
      message: 'Enter the root directory:',
    },
  ])

  return answers.rootDir
}

async function getPrNumber(
  repoPath: string,
  sourceBranch: string,
): Promise<string | null> {
  const result =
    await $`cd ${repoPath} && gh pr list --state all --head ${sourceBranch} --json number --limit 1`
  const prNumber = JSON.parse(result.stdout)[0]?.number
  return prNumber || null
}

async function executeCommand(
  ghCommand: string,
  prNumber: string,
  ghCommandArgs: string,
  repoPath: string,
) {
  switch (ghCommand) {
    case 'pr create':
      await $([
        `cd ${repoPath} && gh ${ghCommand} ${ghCommandArgs} -a @me`,
      ] as unknown as TemplateStringsArray)
      break

    case 'pr merge':
    case 'pr review':
    case 'pr comment':
    case 'pr edit':
      await $([
        `cd ${repoPath} && gh ${ghCommand} ${prNumber} ${ghCommandArgs}`,
      ] as unknown as TemplateStringsArray)
      break

    default:
      throw new Error('Unsupported gh command.')
  }
}

async function traverseDirectories(
  currentPath: string,
  processDirectory: (path: string) => Promise<unknown>,
) {
  const entries = await readdir(currentPath)
  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      choices: entries,
      default: entries,
      name: 'entries',
      message: `Select repos to execute command:`,
    },
  ])

  for (const entry of answers.entries) {
    const entryPath = `${currentPath}/${entry}`
    const entryStat = await stat(entryPath)

    if (entryStat.isDirectory()) {
      await processDirectory(entryPath)
    }
  }
}

interface GhArgs {
  ghCommand: string
  sourceBranch: string
  base: string
  title: string
  body: string
  listChoice: string
  addReviewer: string
}

async function main() {
  const rootDir = await getRootDir()

  const answers = await inquirer.prompt([
    {
      type: 'list',
      choices: ['pr merge', 'pr create', 'pr review', 'pr comment', 'pr edit'],
      name: 'ghCommand',
      message: `Select a \`gh\` command to execute:
  more info: https://cli.github.com/manual/gh_pr
`,
    },
    {
      type: 'input',
      name: 'sourceBranch',
      message: 'Enter the source branch:',
      when: (answers: GhArgs) =>
        [
          'pr merge',
          'pr create',
          'pr review',
          'pr comment',
          'pr edit',
        ].includes(answers.ghCommand),
    },
    {
      type: 'input',
      name: 'base',
      message: 'Enter the base branch for the new pull request:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr create',
    },
    {
      type: 'input',
      name: 'title',
      message: 'Enter the title for the new pull request:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr create',
    },
    {
      type: 'input',
      name: 'body',
      message: 'Enter the body for the new pull request:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr create',
    },
    {
      type: 'list',
      choices: ['comment', 'approve', 'request-changes'],
      name: 'listChoice',
      message: 'Select a review option to execute:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr review',
    },
    {
      type: 'input',
      name: 'body',
      message: 'Enter the review body:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr review',
    },
    {
      type: 'input',
      name: 'body',
      message: 'Enter the comment body:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr comment',
    },
    {
      type: 'input',
      name: 'addReviewer',
      message: "Enter the reviewer's login:",
      when: (answers: GhArgs) => answers.ghCommand === 'pr edit',
    },
    {
      type: 'list',
      choices: ['squash', 'merge', 'rebase'],
      name: 'listChoice',
      message: 'Select a merge option to execute:',
      when: (answers: GhArgs) => answers.ghCommand === 'pr merge',
    },
  ])

  await traverseDirectories(rootDir, async (repoPath) => {
    console.log(`Processing ${repoPath}`)

    switch (answers.ghCommand) {
      case 'pr create':
        {
          const ghCommandArgs = Object.entries(answers)
            .filter(([key]) => key !== 'ghCommand')
            .filter(([, value]) => Boolean(value))
            .map(([key, value]) =>
              key === 'sourceBranch'
                ? `--head=${value}`
                //@ts-ignore
                : `--${kebab(key)}="${value}"`
            )
            .join(' ')

          await executeCommand(answers.ghCommand, '', ghCommandArgs, repoPath)
        }
        break

      case 'pr review':
      case 'pr comment':
      case 'pr merge':
      case 'pr edit':
        {
          const prNumber = await getPrNumber(repoPath, answers.sourceBranch)
          if (prNumber) {
            const ghCommandArgs = Object.entries(answers)
              .filter(([key]) => key !== 'ghCommand' && key !== 'sourceBranch')
              .filter(([, value]) => Boolean(value))
              .map(([key, value]) =>
                key === 'listChoice'
                  ? `--${value}`
                  //@ts-ignore
                  : `--${kebab(key)}="${value}"`
              )
              .join(' ')

            await executeCommand(
              answers.ghCommand,
              prNumber,
              ghCommandArgs,
              repoPath,
            )
          } else {
            console.log(
              `No pull request found for ${answers.sourceBranch} in ${repoPath}`,
            )
          }
        }
        break

      default:
        throw new Error('Unsupported gh command.')
    }
  })

  console.log('Traversal completed.')
}

main()
