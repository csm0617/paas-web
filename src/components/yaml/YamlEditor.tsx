import Editor, { loader } from '@monaco-editor/react'
import { Deployment } from 'kubernetes-models/apps/v1/Deployment'
import { load } from 'js-yaml'
import * as monaco from 'monaco-editor'
import { configureMonacoYaml } from 'monaco-yaml'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import yamlWorker from 'monaco-yaml/yaml.worker?worker'
import deploymentSchemaRaw from './deployment.schema.json?raw'

const deploymentSchema = JSON.parse(deploymentSchemaRaw)

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'yaml') return new yamlWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })
configureMonacoYaml(monaco, {
  validate: true,
  hover: true,
  completion: true,
  format: { enable: true },
  enableSchemaRequest: false,
  schemas: [
    {
      uri: 'https://kubernetes.io/schemas/deployment-apps-v1.json',
      fileMatch: ['*'],
      schema: deploymentSchema,
    },
  ],
})

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, stripNulls(item)]),
    )
  }
  return value
}

/** 校验 Deployment YAML：先做语法解析，再用 kubernetes-models 的 Deployment schema 校验 */
export function validateDeploymentYaml(text: string): string[] {
  if (!text.trim()) return ['YAML 内容不能为空']
  let parsed: unknown
  try {
    parsed = load(text)
  } catch (error) {
    return [`YAML 解析失败：${(error as Error).message}`]
  }
  if (!parsed || typeof parsed !== 'object') return ['YAML 内容不是合法的对象']
  const body = stripNulls(parsed) as Record<string, unknown>
  const kind = body.kind as string | undefined
  if (kind && kind !== 'Deployment') return [`仅支持 Deployment 类型，当前为 ${kind}`]
  body.apiVersion = body.apiVersion || 'apps/v1'
  body.kind = 'Deployment'
  try {
    const model = new Deployment(body as ConstructorParameters<typeof Deployment>[0])
    model.validate()
    return []
  } catch (error) {
    const details = (error as { errors?: Array<{ instancePath?: string; message?: string }> }).errors
    if (details && details.length > 0) {
      return details.map((item) => `${item.instancePath || '/'} ${item.message || '校验失败'}`)
    }
    return [(error as Error).message || '校验失败']
  }
}

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  onValidate?: (errors: string[]) => void
  height?: number | string
}

export function YamlEditor({ value, onChange, onValidate, height = '100%' }: YamlEditorProps) {
  return (
    <Editor
      height={height}
      defaultLanguage="yaml"
      value={value}
      theme="vs-dark"
      onChange={(next) => {
        const text = next ?? ''
        onChange(text)
        onValidate?.(validateDeploymentYaml(text))
      }}
      options={{
        fontSize: 14,
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        wordWrap: 'on',
        renderValidationDecorations: 'on',
        padding: { top: 8, bottom: 8 },
      }}
    />
  )
}

export default YamlEditor
