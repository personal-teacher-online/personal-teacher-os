// Scanner de dado real do repositório público (scripts/vazamento.py, issue #51).
// Roda o script de verdade (python3) contra repositórios temporários. O dado "sujo" é montado em tempo de
// teste (concatenação), senão este arquivo seria barrado pelo próprio scanner.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RepoTemporario, cpfValido, temPython } from './helpers/repo-temporario'

const ARROBA = '@'
const FONE_REAL = ['+55', '11', '9' + '8765-4321'].join(' ')
const FONE_REAL_MASCARADO = '+55 11 9****-***1'

describe.skipIf(!temPython())('scripts/vazamento.py', () => {
  let repo: RepoTemporario

  beforeEach(() => {
    repo = new RepoTemporario()
    repo.instalarScanner()
    repo.git('add', 'scripts/vazamento-excecoes.txt') // --staged lê a lista de exceções do índice
  })
  afterEach(() => repo.limpar())

  /** Escreve o arquivo, põe no índice e roda o scanner no modo pedido. */
  function varrer(conteudo: string, args: string[] = ['--staged'], arquivo = 'docs/nota.md', env = {}) {
    repo.escrever(arquivo, conteudo)
    repo.git('add', arquivo)
    return repo.rodar(args, env)
  }

  it('arquivo limpo, com "Teacher Vicky" e o e-mail de contato, sai 0', () => {
    const r = varrer('Aula da Teacher Vicky. Contato: contato' + ARROBA + 'personal-teacher.com\n')
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('CPF com dígito verificador válido sai 1 e vem mascarado', () => {
    const cpf = cpfValido('123456789')
    const r = varrer(`CPF do aluno: ${cpf}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('CPF valido')
    expect(r.stdout).not.toContain(cpf)
  })

  it('CPF com dígito verificador errado não é CPF', () => {
    const certo = cpfValido('123456789')
    const errado = certo.slice(0, 10) + String((Number(certo[10]) + 1) % 10)
    expect(varrer(`número ${errado}\n`).status).toBe(0)
  })

  it('CNPJ válido sai 1; CPF dentro de número decimal ou de identificador não conta', () => {
    expect(varrer('CNPJ ' + ['11', '444', '777'].join('.') + '/0001-61\n').status).toBe(1)
    const decimal = '-0.' + cpfValido('123456789') + '4'
    expect(varrer(`vetor ${decimal}\n`).status).toBe(0)
  })

  it('nome de migration (14 dígitos de data) não é CNPJ', () => {
    expect(varrer('migration 20260727000900_residuais.sql\n').status).toBe(0)
    expect(varrer('efetiva em 20260727000900\n').status).toBe(0)
  })

  it('e-mail real sai 1, com o domínio à mostra e o resto mascarado', () => {
    const r = varrer('Fale com fulano' + ARROBA + 'gmail.com hoje\n')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('e-mail real')
    expect(r.stdout).toContain('fu***' + ARROBA + 'gmail.com')
    expect(r.stdout).not.toContain('fulano')
  })

  it.each(['exemplo.com', 'x.com', 'local.dev', 'bancada.dev', 'invalid.local'])('e-mail @%s é aceito', (dominio) => {
    expect(varrer('aluno' + ARROBA + dominio + '\n').status).toBe(0)
  })

  it('JID do WhatsApp: faixa fictícia passa, número fora da faixa é acusado como telefone', () => {
    const jid = (n: string) => n + ARROBA + 's.whatsapp.net'
    expect(varrer(`remoteJid ${jid('5565900000001')}\n`).status).toBe(0)
    expect(varrer(`remoteJid ${jid('556599999999')}\n`).status).toBe(0)
    const r = varrer(`remoteJid ${jid('5565' + '991234567')}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('telefone real')
    expect(r.stdout).not.toContain('5565' + '991234567')
  })

  it.each([
    ['celular do Reino Unido', '4479' + '00012345', 's.whatsapp.net'],
    ['celular da Itália', '3939' + '00012345', 's.whatsapp.net'],
    ['assinante de 8 dígitos real', '5565' + '91234567', 's.whatsapp.net'],
    ['grupo antigo com telefone real e timestamp', '5565' + '991234567-1900012345', 'g.us'],
    ['JID com separador e telefone real', '5565' + '991234567_5565900000001', 's.whatsapp.net'],
    ['grupo com telefone real', '5565' + '991234567', 'g.us'],
  ])('JID barrado: %s', (_nome, local, dominio) => {
    const r = varrer(`remoteJid ${local}${ARROBA}${dominio}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain(local)
  })

  it('JID fictício com sufixo de aparelho e de grupo passa; com sufixo e número real é barrado', () => {
    expect(varrer('a 5565900000001:12' + ARROBA + 's.whatsapp.net\n').status).toBe(0)
    expect(varrer('a 5565900000001' + ARROBA + 'g.us\n').status).toBe(0)
    expect(varrer('a 5565' + '991234567:12' + ARROBA + 's.whatsapp.net\n').status).toBe(1)
  })

  it('JID: sufixo é só id de aparelho; %40, maiúsculas e + na frente passam quando fictícios', () => {
    const mal = '5565900000001:5565' + '991234567' + ARROBA + 's.whatsapp.net'
    expect(varrer(`a ${mal}\n`).status).toBe(1)
    expect(varrer('a 5565900000001%40s.whatsapp.net\n').status).toBe(0)
    expect(varrer('a 5565900000001' + ARROBA + 'S.WHATSAPP.NET\n').status).toBe(0)
    expect(varrer('a +5565900000001' + ARROBA + 's.whatsapp.net\n').status).toBe(0)
    expect(varrer('a 5565' + '991234567%40' + 's.whatsapp.net\n').status).toBe(1)
  })

  it('JID em placeholder: <numero> passa; número dentro dos sinais é barrado', () => {
    expect(varrer('use <numero>' + ARROBA + 's.whatsapp.net\n').status).toBe(0)
    expect(varrer('use <4479' + '00012345>' + ARROBA + 's.whatsapp.net\n').status).toBe(1)
    expect(varrer('use <5565' + '991234567>' + ARROBA + 's.whatsapp.net\n').status).toBe(1)
  })

  it('CPF 12345678900 (dígito inválido) passa; CPF válido é acusado', () => {
    expect(varrer('cpf 12345678900\n').status).toBe(0)
    expect(varrer('cpf ' + cpfValido('529982247') + '\n').status).toBe(1)
  })

  it('"logo@2x.png" e loopback não são e-mail; usuario@IP é e mascara o IP', () => {
    expect(varrer('![](logo' + ARROBA + '2x.png) postgres://postgres:senha' + ARROBA + '127.0.0.1:54322/postgres\n').status).toBe(0)
    const r = varrer('ssh deploy' + ARROBA + '203.0.113.7\n')
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain('203.0.113.7')
  })

  it('telefone real sai 1 e mostra só +55 11 9****-***1', () => {
    const r = varrer(`WhatsApp ${FONE_REAL}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(FONE_REAL_MASCARADO)
    expect(r.stdout).not.toContain('8765')
  })

  it.each([
    ['sem o +', '55 11 9' + '8765-4321'],
    ['colado, sem hífen', '+5511' + '9' + '87654321'],
    ['com DDD entre parênteses', '(11) 9' + '8765-4321'],
  ])('telefone real em outro formato (%s) também sai 1', (_nome, fone) => {
    expect(varrer(`ligue ${fone}\n`).status).toBe(1)
  })

  it.each(['+55 65 90000-0001', '+55 65 9' + '9999-1234', '(65) 90005-1234'])('telefone fictício %s sai 0', (fone) => {
    const r = varrer(`WhatsApp ${fone}\n`)
    expect(r.status).toBe(0)
  })

  it('PT_INFRA_TERMOS: termo da VPS sai 1; sem a variável a checagem é pulada com aviso e sai 0', () => {
    const texto = 'subir no host vps-exemplo-01 com o usuario deployer\n'
    const sem = varrer(texto)
    expect(sem.status).toBe(0)
    expect(sem.stderr).toContain('sem PT_INFRA_TERMOS')
    const com = repo.rodar(['--staged'], { PT_INFRA_TERMOS: 'vps-exemplo-01,outro-termo' })
    expect(com.status).toBe(1)
    expect(com.stdout).toContain('PT_INFRA_TERMOS')
    expect(com.stdout).not.toContain('vps-exemplo-01')
  })

  it('lista de nomes: ausente pula com aviso; presente barra o nome sem acento, caixa ou separador', () => {
    const ausente = varrer('Aluna Maria da Fonseca entrou\n')
    expect(ausente.status).toBe(0)
    expect(ausente.stderr).toContain('lista de nomes ausente, parte pulada')

    repo.escrever('scripts/vazamento-nomes.txt', '# nomes\nMaria da Fonseca\nJosé Álvaro\n')
    const presente = repo.rodar(['--staged'])
    expect(presente.status).toBe(1)
    expect(presente.stdout).toContain('nome de pessoa da lista local')
    expect(presente.stdout).not.toContain('Fonseca')

    const outro = varrer('arquivo jose_alvaro.csv\n', ['--staged'], 'docs/outro.md')
    expect(outro.status).toBe(1)
  })

  it('PT_NOMES_PROIBIDOS: o termo da variável barra sem arquivo local, mascarado; variável vazia não quebra', () => {
    const texto = 'Aluno Zelda Exemplar entrou\n'
    const vazia = varrer(texto, ['--staged'], 'docs/nota.md', { PT_NOMES_PROIBIDOS: '' })
    expect(vazia.status).toBe(0)
    expect(vazia.stderr).toContain('lista de nomes ausente')
    const com = repo.rodar(['--staged'], { PT_NOMES_PROIBIDOS: '# nomes\nZelda Exemplar\n' })
    expect(com.status).toBe(1)
    expect(com.stdout).toContain('nome de pessoa da lista local')
    expect(com.stdout).not.toContain('Exemplar')
  })

  it('PT_NOMES_PROIBIDOS soma com o arquivo local: o texto com um termo de cada lado dá 2 achados', () => {
    repo.escrever('scripts/vazamento-nomes.txt', 'Maria da Fonseca\n')
    repo.escrever('docs/nota.md', 'Maria da Fonseca e Zelda Exemplar\n')
    repo.git('add', 'docs/nota.md')
    const r = repo.rodar(['--staged'], { PT_NOMES_PROIBIDOS: 'Zelda Exemplar\n' })
    expect(r.status).toBe(1)
    expect(r.stdout.match(/nome de pessoa da lista local/g)).toHaveLength(2)
  })

  // "Vicky" sozinho também é exceção desde 28/10/2026 (persona pública da marca, issue #50);
  // por isso a prova usa a outra palavra do literal liberado.
  it('termo da lista de exceções ("Teacher Vicky") passa mesmo que a lista de nomes tenha só "Teacher"', () => {
    repo.escrever('scripts/vazamento-nomes.txt', 'Teacher\n')
    expect(varrer('Marca: Teacher Vicky\n').status).toBe(0)
    expect(varrer('Fale com o teacher\n', ['--staged'], 'docs/b.md').status).toBe(1)
  })

  it('linha só de separadores na lista de nomes ou em PT_INFRA_TERMOS não vira termo', () => {
    repo.escrever('scripts/vazamento-nomes.txt', '-\n.\n')
    const r = varrer('texto - com ponto. e hífen\n', ['--staged'], 'docs/c.md', { PT_INFRA_TERMOS: '-, ;.' })
    expect(r.status).toBe(0)
  })

  it.each([
    ['só espaços entre os blocos', 'fone 11 9' + '8765 4321'],
    ['zero antes do DDD', 'tel: 011 9' + '8765-4321'],
    ['Lisboa', '+351 91' + '2 345 678'],
    ['Orlando', '+1 (407) ' + '123-4567'],
  ])('telefone real: %s', (_nome, texto) => {
    expect(varrer(`${texto}\n`).status).toBe(1)
  })

  it('telefone dos EUA só na faixa de ficção 555-01XX passa', () => {
    expect(varrer('+1 (407) ' + '555-0123\n').status).toBe(0)
    expect(varrer('+1 (407) ' + '555-0223\n', ['--staged'], 'docs/d.md').status).toBe(1)
  })

  it('telefone de Portugal na faixa fictícia passa', () => {
    expect(varrer('+351 900 ' + '123 456\n').status).toBe(0)
    expect(varrer('+351900' + '123456\n').status).toBe(0)
  })

  it.each([
    ['9X XXX XXXX', '+351 90 ' + '012 3456'],
    ['9 XXXX XXXX', '+351 9 ' + '0012 3456'],
    ['00351', '00351 900 ' + '123 456'],
    ['parênteses', '+351 (900) ' + '123 456'],
  ])('faixa fictícia de Portugal passa em qualquer agrupamento: %s', (_n, texto) => {
    expect(varrer(`${texto}\n`).status).toBe(0)
  })

  it.each([
    ['9X XXX XXXX', '+351 91 ' + '234 5678'],
    ['9 XXXX XXXX', '+351 9 ' + '1234 5678'],
    ['00351', '00351 912 ' + '345 678'],
    ['parênteses', '+351 (912) ' + '345 678'],
    ['depois de vírgula (CSV)', 'aluno,00351 912 ' + '345 678'],
    ['900 fora do início', '+351 919 ' + '000 000'],
    ['dois números, um fictício e um real', '+351 900' + '123456 e +351 913 ' + '333 333'],
  ])('telefone real de Portugal barra em qualquer agrupamento: %s', (_n, texto) => {
    const r = varrer(`${texto}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('+351 9****-***')
  })

  it('sequência de 14 dígitos de CNPJ liberado e float colado não viram telefone de Portugal', () => {
    const cnpj = '00351912' + '000108'
    repo.escrever('scripts/vazamento-excecoes.txt', `${cnpj}\n`)
    repo.git('add', 'scripts/vazamento-excecoes.txt')
    expect(varrer(`cnpj ${cnpj}\n`).status).toBe(0)
    expect(varrer('x=0.00351' + '912345678,\n').status).toBe(0)
  })

  it('telefone de Portugal fora da faixa fictícia barra, com a saída mascarada', () => {
    const r = varrer('+351 91' + '2 345 678\n')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('+351 9****-***8')
    expect(r.stdout).not.toContain('345')
  })

  it('e-mail de empresa sai com o domínio mascarado; provedor genérico mostra o domínio', () => {
    const empresa = varrer('aluno' + ARROBA + 'empresa-do-aluno.com.br\n')
    expect(empresa.status).toBe(1)
    expect(empresa.stdout).not.toContain('empresa-do-aluno')
    expect(empresa.stdout).toContain('al***' + ARROBA + '***.br')
  })

  it('usuario@IP sai exatamente como de***@***, sem pedaço do IP', () => {
    const r = varrer('ssh deploy' + ARROBA + '203.0.113.54\n')
    expect(r.stdout).toContain('de***' + ARROBA + '***')
    expect(r.stdout).not.toMatch(/\*\*\*\.\d|\b54\b|203/)
  })

  it('imagem só passa em public/, brand/ e src/', () => {
    const png = Buffer.from([0x89, 0x50, 0x00, 0x01])
    for (const [arquivo, esperado] of [['src/a.png', 0], ['brand/a.png', 0], ['docs/print.png', 1], ['tests/print.jpg', 1]] as const) {
      repo.escrever(arquivo, png)
      repo.git('add', arquivo)
      expect(repo.rodar(['--staged']).status, arquivo).toBe(esperado)
      repo.git('rm', '-q', '--cached', '-f', arquivo)
    }
  })

  it('--base varre a mensagem do commit, mas não o nome de autor (que está na lista de nomes)', () => {
    repo.escrever('docs/base.md', 'base\n')
    repo.git('add', 'docs/base.md')
    repo.git('commit', '-q', '-m', 'base')
    repo.git('checkout', '-q', '-b', 'pr')
    repo.escrever('docs/ok.md', 'limpo\n')
    repo.git('add', 'docs/ok.md')
    repo.git('commit', '-q', '-m', 'ajuste\n\nFale com fulano' + ARROBA + 'gmail.com')
    const r = repo.rodar(['--base', 'main'])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('[mensagem]@')

    repo.escrever('scripts/vazamento-nomes.txt', 'Teste\n') // é o user.name do repositório temporário
    repo.git('commit', '-q', '--amend', '-m', 'ajuste limpo')
    expect(repo.rodar(['--base', 'main']).status).toBe(0)
  })

  it('domínio .md é e-mail de verdade', () => {
    expect(varrer('fulano' + ARROBA + 'empresa.md\n').status).toBe(1)
  })

  it.each([
    '11 9' + '8765-4321',
    '+55 11 9 ' + '8765-4321',
    '(11)9 ' + '8765 4321',
  ])('telefone real em formato solto (%s) também sai 1', (fone) => {
    expect(varrer(`ligue ${fone}\n`).status).toBe(1)
  })

  it('binário: .png passa; .bin sai 1; .pdf só em public/ e brand/', () => {
    const binario = Buffer.from([0x89, 0x50, 0x00, 0x01, 0x00])
    for (const [arquivo, esperado] of [
      ['public/logo.png', 0],
      ['public/fonte.woff2', 0],
      ['src/dados.bin', 1],
      ['public/manual.pdf', 0],
      ['brand/manual.pdf', 0],
      ['docs/contrato.pdf', 1],
    ] as const) {
      repo.escrever(arquivo, binario)
      repo.git('add', arquivo)
      expect(repo.rodar(['--staged']).status, arquivo).toBe(esperado)
      repo.git('reset', '-q')
      repo.git('rm', '-q', '--cached', '-f', '--ignore-unmatch', arquivo)
    }
  })

  it('sem argumento varre a árvore versionada inteira; arquivo não versionado fica de fora', () => {
    repo.escrever('docs/limpo.md', 'nada aqui\n')
    repo.escrever('docs/sujo.md', 'fulano' + ARROBA + 'gmail.com\n')
    repo.git('add', 'docs/limpo.md')
    expect(repo.rodar().status).toBe(0)
    repo.git('add', 'docs/sujo.md')
    expect(repo.rodar().status).toBe(1)
  })

  it('--base varre cada commit da PR: dado que entra e sai continua no histórico', () => {
    repo.escrever('docs/base.md', 'base\n')
    repo.git('add', 'docs/base.md')
    repo.git('commit', '-q', '-m', 'base')
    repo.git('checkout', '-q', '-b', 'pr')
    repo.escrever('docs/vaza.md', 'fulano' + ARROBA + 'gmail.com\n')
    repo.git('add', 'docs/vaza.md')
    repo.git('commit', '-q', '-m', 'entra')
    repo.git('rm', '-q', 'docs/vaza.md')
    repo.git('commit', '-q', '-m', 'sai')
    expect(repo.rodar([]).status).toBe(0) // a árvore já está limpa
    const r = repo.rodar(['--base', 'main'])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('docs/vaza.md@')
  })

  it('--push varre os commits que o push envia (stdin do pre-push)', () => {
    repo.escrever('docs/base.md', 'base\n')
    repo.git('add', 'docs/base.md')
    repo.git('commit', '-q', '-m', 'base')
    const antes = repo.git('rev-parse', 'HEAD').stdout.trim()
    repo.escrever('docs/vaza.md', 'fulano' + ARROBA + 'gmail.com\n')
    repo.git('add', 'docs/vaza.md')
    repo.git('commit', '-q', '-m', 'vaza')
    const depois = repo.git('rev-parse', 'HEAD').stdout.trim()
    const r = repo.rodar(['--push'], {}, `refs/heads/main ${depois} refs/heads/main ${antes}\n`)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('docs/vaza.md@')
    const limpo = repo.rodar(['--push'], {}, `refs/heads/main ${antes} refs/heads/main ${'0'.repeat(40)}\n`)
    expect(limpo.status).toBe(0)
  })

  it('lista de exceções malformada sai 2', () => {
    repo.escrever('scripts/vazamento-excecoes.txt', '!!! lixo\n')
    repo.git('add', 'scripts/vazamento-excecoes.txt')
    repo.escrever('docs/a.md', 'a\n')
    repo.git('add', 'docs/a.md')
    expect(repo.rodar(['--staged']).status).toBe(2)
  })
})
