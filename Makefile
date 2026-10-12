AWS_REGION ?= eu-west-1
STACK_NAME ?= TravelPlan

.PHONY: install pdf-deps test synth diff deploy set-secrets outputs dev

install: pdf-deps
	npm ci

# Runtime dependencies of the PDF function (pdfkit), bundled into its Lambda asset.
pdf-deps:
	npm ci --prefix lambda/pdf --omit=dev --no-audit --no-fund

test:
	npm test -- --runInBand

synth:
	AWS_REGION=$(AWS_REGION) npm run synth -- --quiet

diff:
	AWS_REGION=$(AWS_REGION) npm run diff

deploy: pdf-deps test
	AWS_REGION=$(AWS_REGION) npm run deploy

set-secrets:
	AWS_REGION=$(AWS_REGION) scripts/set-secrets.sh

outputs:
	aws cloudformation describe-stacks --region $(AWS_REGION) --stack-name $(STACK_NAME) \
		--query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table

dev:
	node scripts/dev-server.js
